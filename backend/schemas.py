from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
import json
from models import JobStatus, JobType

class JobBase(BaseModel):
    job_type: JobType

class JobCreate(JobBase):
    selected_ids: Optional[List[str]] = None

class JobResponse(JobBase):
    id: int
    account_id: Optional[int]
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
    name: Optional[str] = None
    picture: Optional[str] = None

    class Config:
        from_attributes = True

class PolicyBase(BaseModel):
    name: str
    job_type: JobType
    frequency: str # DAILY, WEEKLY, MONTHLY
    start_time: str # HH:MM
    selected_ids: Optional[List[str]] = None
    is_active: int = 1

    @field_validator('selected_ids', mode='before')
    @classmethod
    def parse_selected_ids(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except:
                return []
        return v

class PolicyCreate(PolicyBase):
    account_id: int

class PolicyResponse(PolicyBase):
    id: int
    account_id: int
    last_run: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True
