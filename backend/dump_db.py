import os
import sys
import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.getcwd())
import models
from database import SessionLocal

def dump_policies():
    db = SessionLocal()
    try:
        policies = db.query(models.Policy).all()
        print(f"Total Policies in DB: {len(policies)}")
        for p in policies:
            print(f"ID: {p.id}, Name: {p.name}, Active: {p.is_active}, Time: {p.start_time}, Frequency: {p.frequency}, Last Run: {p.last_run}")
            
        jobs = db.query(models.Job).order_by(models.Job.id.desc()).limit(5).all()
        print(f"\nLast 5 Jobs:")
        for j in jobs:
            print(f"ID: {j.id}, Type: {j.job_type}, Status: {j.status}, Created: {j.created_at}")
    finally:
        db.close()

if __name__ == "__main__":
    dump_policies()
