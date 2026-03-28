from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import os
import json
from dotenv import load_dotenv
import models
import schemas
import services
from database import engine, get_db

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

@app.get("/")
def read_root():
    return {"status": "ok", "app": "GWP Backend"}

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
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google API Error: {str(e)}")
    
    account = db.query(models.Account).filter(models.Account.email == email).first()
    if not account:
        account = models.Account(email=email, credentials_json=creds_json)
        db.add(account)
    else:
        account.credentials_json = creds_json
    db.commit()
    db.refresh(account)
    return {"status": "success", "account_id": account.id}

@app.get("/accounts/")
def list_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()

async def run_backup_job(job_id: int, account_id: int, db: Session):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not job or not account:
        return
    
    job.status = models.JobStatus.RUNNING
    db.commit()

    dest_dir = os.path.join("backups", str(account.id), job.job_type.value)
    os.makedirs(dest_dir, exist_ok=True)

    try:
        sel_ids = json.loads(job.selected_ids) if job.selected_ids else None
        
        if job.job_type == models.JobType.GDRIVE:
            result = await services.backup_gdrive(account.credentials_json, dest_dir, sel_ids)
        elif job.job_type == models.JobType.GMAIL:
            result = await services.backup_gmail(account.credentials_json, dest_dir, sel_ids)
        
        job.status = models.JobStatus.COMPLETED
        job.destination_path = dest_dir
        job.completed_at = models.func.now()
    except Exception as e:
        job.status = models.JobStatus.FAILED
        job.error_message = str(e)
    
    db.commit()

@app.get("/gdrive/files/")
def get_gdrive_files(account_id: int, parent_id: str = "root", page_token: str = None, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    try:
        results = services.list_gdrive_files(account.credentials_json, parent_id, page_token)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/gmail/messages/")
def get_gmail_messages(account_id: int, query: str = None, page_token: str = None, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    try:
        results = services.list_gmail_messages(account.credentials_json, query, page_token)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/jobs/", response_model=schemas.JobResponse)
def create_job(account_id: int, job: schemas.JobCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found. Please authenticate first.")
        
    db_job = models.Job(
        job_type=job.job_type, 
        status=models.JobStatus.PENDING,
        selected_ids=json.dumps(job.selected_ids) if job.selected_ids else None
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    
    background_tasks.add_task(run_backup_job, db_job.id, account.id, db)
    
    return db_job

@app.get("/jobs/", response_model=List[schemas.JobResponse])
def list_jobs(db: Session = Depends(get_db)):
    return db.query(models.Job).order_by(models.Job.id.desc()).all()

@app.get("/jobs/{job_id}", response_model=schemas.JobResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
