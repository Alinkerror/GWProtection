from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from models import JobStatus, JobType

class JobBase(BaseModel):
    job_type: JobType
    selected_ids: Optional[list[str]] = None

class JobCreate(JobBase):
    pass

class JobResponse(JobBase):
    id: int
    status: JobStatus
    created_at: datetime
    completed_at: Optional[datetime] = None
    destination_path: Optional[str] = None
    error_message: Optional[str] = None

    class Config:
        orm_mode = True

class AccountResponse(BaseModel):
    id: int
    email: str

    class Config:
        orm_mode = True
