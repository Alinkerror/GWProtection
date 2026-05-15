import os
import sys
import json
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add current directory to path so we can import main and models
sys.path.append(os.getcwd())

import models
import main
from database import Base

# Setup in-memory database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def test_policy_submission():
    print("--- Starting Policy Submission Test ---")
    
    # Create tables
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    try:
        # 1. Create a mock account
        account = models.Account(
            email="test@example.com",
            name="Test User",
            credentials_json=json.dumps({"token": "fake-token"})
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        print(f"Created test account: ID {account.id}")
        
        # 2. Create an active policy scheduled for 10 minutes ago
        now = datetime.now()
        ten_mins_ago = now - timedelta(minutes=10)
        start_time_str = ten_mins_ago.strftime("%H:%M")
        
        policy = models.Policy(
            account_id=account.id,
            name="Test Daily Policy",
            job_type=models.JobType.GDRIVE,
            frequency=models.Frequency.DAILY,
            start_time=start_time_str,
            is_active=1
        )
        db.add(policy)
        db.commit()
        db.refresh(policy)
        print(f"Created test policy: '{policy.name}' scheduled for {start_time_str}")
        
        # 3. Verify current state
        policies = db.query(models.Policy).filter(models.Policy.is_active == 1).all()
        print(f"Active policies in DB: {len(policies)}")
        
        # 4. Run the core scheduler logic
        print(f"Running scheduler check for time: {now.strftime('%H:%M:%S')}")
        triggered = main.check_and_trigger_policies(db, now)
        
        # 5. Verify if a job was created
        jobs = db.query(models.Job).all()
        print(f"Jobs in DB after check: {len(jobs)}")
        
        if len(jobs) > 0:
            job = jobs[0]
            print(f"✅ SUCCESS: Job {job.id} was submitted!")
            print(f"Job Details: Type={job.job_type}, Status={job.status}, Path={job.destination_path}")
            
            # Check if policy last_run was updated
            db.refresh(policy)
            if policy.last_run:
                print(f"✅ SUCCESS: Policy last_run updated to {policy.last_run}")
            else:
                print("❌ FAILURE: Policy last_run NOT updated")
        else:
            print("❌ FAILURE: No job was submitted")
            
            # Diagnostic: check why it wasn't triggered
            start_h, start_m = map(int, policy.start_time.split(':'))
            scheduled_today = now.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
            print(f"Diagnostic - Now: {now}")
            print(f"Diagnostic - Scheduled: {scheduled_today}")
            print(f"Diagnostic - Now >= Scheduled: {now >= scheduled_today}")
            print(f"Diagnostic - Policy last_run: {policy.last_run}")
            print(f"Diagnostic - Policy Frequency: {policy.frequency}")
            
    finally:
        db.close()

if __name__ == "__main__":
    test_policy_submission()
