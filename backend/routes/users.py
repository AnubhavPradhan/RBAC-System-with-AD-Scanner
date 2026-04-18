"""
User CRUD routes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, User, AuditLog
from auth import get_current_user, hash_password, validate_password_strength

router = APIRouter(prefix="/api/users", tags=["Users"])
ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _normalize_days(days: Optional[list[str]]) -> list[str]:
    if not days:
        return []
    valid = set(ALL_DAYS)
    normalized = [str(d).strip() for d in days if str(d).strip() in valid]
    # Keep insertion order while removing duplicates
    return list(dict.fromkeys(normalized))


class UserCreate(BaseModel):
    name: str
    username: Optional[str] = None
    email: str
    password: Optional[str] = "changeme123"
    role: Optional[str] = "Viewer"
    status: Optional[str] = "Active"
    time_override_enabled: Optional[bool] = False
    allowed_days: Optional[list[str]] = None
    access_start_time: Optional[str] = "00:00"
    access_end_time: Optional[str] = "23:59"


class UserUpdate(BaseModel):
    name: str
    username: Optional[str] = None
    email: str
    password: Optional[str] = None
    role: str
    status: str
    time_override_enabled: Optional[bool] = False
    allowed_days: Optional[list[str]] = None
    access_start_time: Optional[str] = "00:00"
    access_end_time: Optional[str] = "23:59"


def _user_dict(u: User) -> dict:
    allowed_days = [d.strip() for d in (u.allowed_days or "").split(",") if d.strip()]
    return {
        "id": u.id, "name": u.name, "username": u.username,
        "email": u.email, "role": u.role, "status": u.status,
        "created_at": str(u.created_at),
        "last_login": str(u.last_login).split('.')[0] if u.last_login else None,
        "time_override_enabled": bool(u.time_override_enabled),
        "allowed_days": allowed_days,
        "access_start_time": u.access_start_time or "00:00",
        "access_end_time": u.access_end_time or "23:59",
        "timezone": "Asia/Kathmandu",
    }


@router.get("")
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [_user_dict(u) for u in users]


@router.post("", status_code=201)
def create_user(body: UserCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    if not body.name or not body.email:
        raise HTTPException(400, "Name and email are required")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(409, "Email already exists")
    raw_password = body.password or "changeme123"
    is_valid, msg = validate_password_strength(raw_password)
    if not is_valid:
        raise HTTPException(400, msg)

    normalized_days = ALL_DAYS if body.allowed_days is None else _normalize_days(body.allowed_days)

    new_user = User(
        name=body.name, username=body.username or None, email=body.email,
        password=hash_password(raw_password),
        role=body.role or "Viewer", status=body.status or "Active",
        time_override_enabled=bool(body.time_override_enabled),
        allowed_days=",".join(normalized_days),
        access_start_time=body.access_start_time or "00:00",
        access_end_time=body.access_end_time or "23:59",
    )
    db.add(new_user)
    db.flush()

    db.add(AuditLog(user_email=current_user.email, action="Create", resource="User",
                    details=f"Created user: {body.email}", severity="Info"))
    db.commit()
    db.refresh(new_user)
    return _user_dict(new_user)


@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    normalized_days = ALL_DAYS if body.allowed_days is None else _normalize_days(body.allowed_days)

    user.name = body.name
    user.username = body.username or None
    user.email = body.email
    user.role = body.role
    user.status = body.status
    user.time_override_enabled = bool(body.time_override_enabled)
    user.allowed_days = ",".join(normalized_days)
    user.access_start_time = body.access_start_time or "00:00"
    user.access_end_time = body.access_end_time or "23:59"
    if body.password and body.password.strip():
        is_valid, msg = validate_password_strength(body.password)
        if not is_valid:
            raise HTTPException(400, msg)
        user.password = hash_password(body.password)

    db.add(AuditLog(user_email=current_user.email, action="Update", resource="User",
                    details=f"Updated user: {body.email}", severity="Info"))
    db.commit()
    db.refresh(user)
    return _user_dict(user)


@router.delete("/{user_id}")
def delete_user(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    db.add(AuditLog(user_email=current_user.email, action="Delete", resource="User",
                    details=f"Deleted user: {user.email}", severity="Warning"))
    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}
