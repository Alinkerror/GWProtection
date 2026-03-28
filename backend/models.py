from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey
from sqlalchemy.sql import func
import enum
from database import Base

class JobStatus(enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class JobType(enum.Enum):
    GMAIL = "GMAIL"
    GDRIVE = "GDRIVE"

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(Enum(JobType))
    status = Column(Enum(JobStatus), default=JobStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    destination_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    selected_ids = Column(String, nullable=True) # JSON serialized list of IDs

class Account(Base):
    __tablename__ = "accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    credentials_json = Column(String) # Store OAuth credentials

