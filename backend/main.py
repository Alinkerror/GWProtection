from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List
import os
import json
import shutil
import shutil
import time
import threading
from datetime import datetime, timedelta
from dotenv import load_dotenv
import models
import schemas
import services
from database import engine, get_db, SessionLocal

load_dotenv()

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Google Workspace Protection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/auth/url")
def get_auth_url(redirect_uri: str):
    if not os.getenv("GOOGLE_CLIENT_ID") or not os.getenv("GOOGLE_CLIENT_SECRET"):
        return {"error": "Google Credentials are not set in the .env file."}
    return {"url": services.get_auth_url(redirect_uri)}

@app.post("/auth/exchange")
def exchange_code(code: str, email: str, redirect_uri: str, db: Session = Depends(get_db)):
    if not os.getenv("GOOGLE_CLIENT_ID") or not os.getenv("GOOGLE_CLIENT_SECRET"):
        raise HTTPException(status_code=500, detail="Google Credentials not set in .env")
        
    try:
        creds_json = services.exchange_code(code, redirect_uri)
        # Fetch user profile info
        user_info = services.get_user_info(creds_json)
        name = user_info.get('name')
        picture = user_info.get('picture')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google API Error: {str(e)}")
    
    account = db.query(models.Account).filter(models.Account.email == email).first()
    if not account:
        account = models.Account(email=email, name=name, picture=picture, credentials_json=creds_json)
        db.add(account)
    else:
        # Smart merge: If new creds don't have a refresh token (because consent was skipped), 
        # keep the old one.
        new_creds = json.loads(creds_json)
        old_creds = json.loads(account.credentials_json) if account.credentials_json else {}
        
        if 'refresh_token' not in new_creds and 'refresh_token' in old_creds:
            new_creds['refresh_token'] = old_creds['refresh_token']
            
        account.credentials_json = json.dumps(new_creds)
        account.name = name
        account.picture = picture
        
    db.commit()
    db.refresh(account)
    return {"status": "success", "account_id": account.id}

@app.get("/accounts/")
def list_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()

def run_backup_job(job_id: int, account_id: int):
    # Log startup
    print(f"Starting background job {job_id} for account {account_id}")
    
    import asyncio
    
    # 1. Get initial data
    db = SessionLocal()
    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        account = db.query(models.Account).filter(models.Account.id == account_id).first()
        if not job or not account:
            return
        
        creds = account.credentials_json
        job_type = job.job_type
        sel_ids = json.loads(job.selected_ids) if job.selected_ids else None
    finally:
        db.close()

    # 2. Run the actual backup (This is blocking work, but it's in a separate thread)
    dest_dir = os.path.join("backups", str(account_id), f"{job_type.value}_{job_id}")
    os.makedirs(dest_dir, exist_ok=True)
    
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        result = ""
        new_creds = None
        
        if job_type == models.JobType.GDRIVE:
            result, new_creds = loop.run_until_complete(services.backup_gdrive(creds, dest_dir, sel_ids))
        elif job_type == models.JobType.GMAIL:
            result, new_creds = loop.run_until_complete(services.backup_gmail(creds, dest_dir, sel_ids))
        
        loop.close()

        # 3. Success: Refresh and update
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            account = db.query(models.Account).filter(models.Account.id == account_id).first()
            
            if job:
                job.status = models.JobStatus.COMPLETED
                job.destination_path = dest_dir
                job.completed_at = func.now()
            
            if account and new_creds:
                account.credentials_json = new_creds
                
            db.commit()
        finally:
            db.close()
            
    except Exception as e:
        print(f"Error in job {job_id}: {str(e)}")
        db = SessionLocal()
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.status = models.JobStatus.FAILED
                job.error_message = str(e)
                db.commit()
        finally:
            db.close()

def run_restore_job(restore_job_id: int, source_job_id: int, account_id: int):
    print(f"Starting restore job {restore_job_id} from source {source_job_id}")
    import asyncio
    
    db = SessionLocal()
    try:
        restore_job = db.query(models.Job).filter(models.Job.id == restore_job_id).first()
        source_job = db.query(models.Job).filter(models.Job.id == source_job_id).first()
        account = db.query(models.Account).filter(models.Account.id == account_id).first()
        
        if not restore_job or not source_job or not account:
            return
            
        creds = account.credentials_json
        source_path = source_job.destination_path
        job_type = restore_job.job_type
    finally:
        db.close()
        
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        result = ""
        new_creds = None
        
        if job_type == models.JobType.RESTORE_GDRIVE:
            result, new_creds = loop.run_until_complete(services.restore_gdrive(creds, source_path))
        elif job_type == models.JobType.RESTORE_GMAIL:
            result, new_creds = loop.run_until_complete(services.restore_gmail(creds, source_path))
            
        loop.close()
        
        db = SessionLocal()
        try:
            r_job = db.query(models.Job).filter(models.Job.id == restore_job_id).first()
            acc = db.query(models.Account).filter(models.Account.id == account_id).first()
            if r_job:
                r_job.status = models.JobStatus.COMPLETED
                r_job.completed_at = func.now()
            if acc and new_creds:
                acc.credentials_json = new_creds
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"Restore error: {str(e)}")
        db = SessionLocal()
        try:
            r_job = db.query(models.Job).filter(models.Job.id == restore_job_id).first()
            if r_job:
                r_job.status = models.JobStatus.FAILED
                r_job.error_message = str(e)
            db.commit()
        finally:
            db.close()


def run_expiry_job(expiry_job_id: int, source_job_id: int):
    print(f"Starting expiry job {expiry_job_id} for source {source_job_id}")
    db = SessionLocal()
    try:
        exp_job = db.query(models.Job).filter(models.Job.id == expiry_job_id).first()
        src_job = db.query(models.Job).filter(models.Job.id == source_job_id).first()
        
        if not exp_job or not src_job:
            return
            
        path = src_job.destination_path
        if path and os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
            
        # Update source job to EXPIRED
        src_job.status = models.JobStatus.EXPIRED
        src_job.destination_path = None # Clear path as data is gone
        
        # Update expiry job to COMPLETED
        exp_job.status = models.JobStatus.COMPLETED
        exp_job.completed_at = func.now()
        db.commit()
    except Exception as e:
        print(f"Expiry error: {str(e)}")
        if exp_job:
            exp_job.status = models.JobStatus.FAILED
            exp_job.error_message = str(e)
            db.commit()
    finally:
        db.close()

def automated_cleanup_worker():
    """Background thread to check for expired backups every hour."""
    while True:
        print("Running automated 7-day cleanup check...")
        db = SessionLocal()
        try:
            seven_days_ago = datetime.now() - timedelta(days=7)
            # Find completed backups older than 7 days that haven't been expired yet
            expired_jobs = db.query(models.Job).filter(
                models.Job.status == models.JobStatus.COMPLETED,
                models.Job.created_at < seven_days_ago
            ).all()
            
            for job in expired_jobs:
                # Create a new EXPIRY job for visibility
                expiry_job = models.Job(
                    job_type=models.JobType.EXPIRY,
                    status=models.JobStatus.RUNNING
                )
                db.add(expiry_job)
                db.commit()
                db.refresh(expiry_job)
                
                # Run the actual deletion
                run_expiry_job(expiry_job.id, job.id)
                
        except Exception as e:
            print(f"Cleanup worker error: {str(e)}")
        finally:
            db.close()
        
        # Wait for 1 hour
        time.sleep(3600)

def automated_policy_worker():
    """Background thread to check for scheduled policies every minute."""
    while True:
        db = SessionLocal()
        try:
            now = datetime.now()
            current_time_str = now.strftime("%H:%M")
            
            # Find active policies that match current time
            policies = db.query(models.Policy).filter(
                models.Policy.is_active == 1,
                models.Policy.start_time == current_time_str
            ).all()
            
            for policy in policies:
                # Check frequency
                should_run = False
                if not policy.last_run:
                    should_run = True
                else:
                    # Simple daily check: has it run today?
                    if policy.frequency == models.Frequency.DAILY:
                        if policy.last_run.date() < now.date():
                            should_run = True
                    elif policy.frequency == models.Frequency.WEEKLY:
                        if policy.last_run < now - timedelta(days=7):
                            should_run = True
                    elif policy.frequency == models.Frequency.MONTHLY:
                        if policy.last_run < now - timedelta(days=30):
                            should_run = True
                
                if should_run:
                    print(f"Triggering automated policy: {policy.name}")
                    new_job = models.Job(
                        account_id=policy.account_id,
                        job_type=policy.job_type,
                        status=models.JobStatus.RUNNING,
                        selected_ids=policy.selected_ids
                    )
                    db.add(new_job)
                    policy.last_run = now
                    db.commit()
                    db.refresh(new_job)
                    
                    # Start the job
                    threading.Thread(target=run_backup_job, args=(new_job.id, policy.account_id)).start()
                    
        except Exception as e:
            print(f"Policy worker error: {str(e)}")
        finally:
            db.close()
        time.sleep(60)

@app.on_event("startup")
def startup_event():
    # Start the automated cleanup thread
    threading.Thread(target=automated_cleanup_worker, daemon=True).start()
    # Start the policy automation thread
    threading.Thread(target=automated_policy_worker, daemon=True).start()

@app.get("/gdrive/files/")
def get_gdrive_files(account_id: int, parent_id: str = "root", page_token: str = None, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    try:
        results, new_creds = services.list_gdrive_files(account.credentials_json, parent_id, page_token)
        if new_creds:
            account.credentials_json = new_creds
            db.commit()
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/gmail/messages/")
def get_gmail_messages(account_id: int, query: str = None, page_token: str = None, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    try:
        results, new_creds = services.list_gmail_messages(account.credentials_json, query, page_token)
        if new_creds:
            account.credentials_json = new_creds
            db.commit()
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/jobs/", response_model=schemas.JobResponse)
def create_job(account_id: int, job: schemas.JobCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found. Please authenticate first.")
        
    db_job = models.Job(
        account_id=account_id,
        job_type=job.job_type, 
        status=models.JobStatus.RUNNING,
        selected_ids=json.dumps(job.selected_ids) if job.selected_ids else None
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    
    background_tasks.add_task(run_backup_job, db_job.id, account.id)
    
    return db_job

# Policy Management Endpoints

@app.post("/policies/", response_model=schemas.PolicyResponse)
def create_policy(policy: schemas.PolicyCreate, db: Session = Depends(get_db)):
    db_policy = models.Policy(
        account_id=policy.account_id,
        name=policy.name,
        job_type=policy.job_type,
        frequency=models.Frequency(policy.frequency),
        start_time=policy.start_time,
        selected_ids=json.dumps(policy.selected_ids) if policy.selected_ids else None,
        is_active=policy.is_active
    )
    db.add(db_policy)
    db.commit()
    db.refresh(db_policy)
    return db_policy

@app.get("/policies/", response_model=List[schemas.PolicyResponse])
def list_policies(account_id: int, db: Session = Depends(get_db)):
    return db.query(models.Policy).filter(models.Policy.account_id == account_id).all()

@app.delete("/policies/{policy_id}")
def delete_policy(policy_id: int, db: Session = Depends(get_db)):
    policy = db.query(models.Policy).filter(models.Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    db.delete(policy)
    db.commit()
    return {"status": "success"}

@app.get("/jobs/", response_model=List[schemas.JobResponse])
def list_jobs(limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    return db.query(models.Job).order_by(models.Job.id.desc()).offset(offset).limit(limit).all()

@app.post("/jobs/{job_id}/restore", response_model=schemas.JobResponse)
def restore_job(job_id: int, account_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    source_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not source_job or source_job.status != models.JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Only completed backups can be restored.")
        
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    restore_type = models.JobType.RESTORE_GDRIVE if source_job.job_type == models.JobType.GDRIVE else models.JobType.RESTORE_GMAIL
    
    new_job = models.Job(
        job_type=restore_type,
        status=models.JobStatus.RUNNING
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)
    
    background_tasks.add_task(run_restore_job, new_job.id, source_job.id, account.id)
    return new_job

@app.post("/jobs/{job_id}/expire", response_model=schemas.JobResponse)
def manual_expire_job(job_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    source_job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not source_job or source_job.status != models.JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Only completed backups can be expired.")
        
    expiry_job = models.Job(
        job_type=models.JobType.EXPIRY,
        status=models.JobStatus.RUNNING
    )
    db.add(expiry_job)
    db.commit()
    db.refresh(expiry_job)
    
    background_tasks.add_task(run_expiry_job, expiry_job.id, source_job.id)
    return expiry_job

@app.get("/jobs/{job_id}", response_model=schemas.JobResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    print(f"Request to delete job {job_id}")
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        print(f"Job {job_id} not found in DB")
        raise HTTPException(status_code=404, detail="Job not found")
        
    path = job.destination_path
    if path and os.path.exists(path):
        print(f"Deleting directory: {path}")
        shutil.rmtree(path, ignore_errors=True)
    else:
        print(f"No directory found at {path} to delete")
        
    db.delete(job)
    db.commit()
    print(f"Job {job_id} deleted successfully from DB")
    return {"status": "success", "message": "Job expired and deleted."}

@app.get("/usage/")
def get_usage(db: Session = Depends(get_db)):
    jobs = db.query(models.Job).filter(models.Job.status == models.JobStatus.COMPLETED).all()
    usage_by_date = {}
    
    def get_dir_size(path):
        total = 0
        try:
            for dirpath, dirnames, filenames in os.walk(path):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if not os.path.islink(fp):
                        total += os.path.getsize(fp)
        except Exception:
            pass
        return total

    for job in jobs:
        dt = job.completed_at if job.completed_at else job.created_at
        dt_str = dt.strftime('%Y-%m-%d')
        
        bytes_used = 0
        if job.destination_path and os.path.exists(job.destination_path):
            bytes_used = get_dir_size(job.destination_path)
            
        if dt_str not in usage_by_date:
            usage_by_date[dt_str] = 0
        usage_by_date[dt_str] += bytes_used
        
    data = [{"date": d, "mb": round(b / (1024 * 1024), 2)} for d, b in usage_by_date.items()]
    data.sort(key=lambda x: x["date"])
    return data

app.mount("/", StaticFiles(directory="static", html=True), name="static")
