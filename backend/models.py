from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey
from sqlalchemy.sql import func
import enum
from database import Base

class JobStatus(enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"

class JobType(enum.Enum):
    GMAIL = "GMAIL"
    GDRIVE = "GDRIVE"
    RESTORE_GMAIL = "RESTORE_GMAIL"
    RESTORE_GDRIVE = "RESTORE_GDRIVE"
    EXPIRY = "EXPIRY"

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    job_type = Column(Enum(JobType))
    status = Column(Enum(JobStatus), default=JobStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    destination_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    selected_ids = Column(String, nullable=True) # JSON serialized list of IDs
    filters = Column(String, nullable=True) # JSON criteria

class Account(Base):
    __tablename__ = "accounts"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    credentials_json = Column(String) # Store OAuth credentials

class Frequency(enum.Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"

class Policy(Base):
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"))
    name = Column(String)
    job_type = Column(Enum(JobType))
    frequency = Column(Enum(Frequency))
    start_time = Column(String) # HH:MM
    selected_ids = Column(String, nullable=True) # JSON serialized list of IDs
    filters = Column(String, nullable=True) # JSON criteria like label and time
    is_active = Column(Integer, default=1) # 1=Active, 0=Paused
    last_run = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

