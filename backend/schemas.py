from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from models import JobStatus, JobType

class JobBase(BaseModel):
    job_type: JobType

class JobCreate(JobBase):
    selected_ids: Optional[list[str]] = None

class JobResponse(JobBase):
    id: int
    status: JobStatus
    created_at: datetime
    completed_at: Optional[datetime] = None
    destination_path: Optional[str] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True

class AccountResponse(BaseModel):
    id: int
    email: str

    class Config:
        from_attributes = True
