"""
User CRUD routes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, User, AuditLog
from auth import get_current_user, hash_password

router = APIRouter(prefix="/api/users", tags=["Users"])


class UserCreate(BaseModel):
    name: str
    username: Optional[str] = None
    email: str
    password: Optional[str] = "changeme123"
    role: Optional[str] = "Viewer"
    status: Optional[str] = "Active"


class UserUpdate(BaseModel):
    name: str
    username: Optional[str] = None
    email: str
    password: Optional[str] = None
    role: str
    status: str


def _user_dict(u: User) -> dict:
    return {
        "id": u.id, "name": u.name, "username": u.username,
        "email": u.email, "role": u.role, "status": u.status,
        "created_at": str(u.created_at),
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

    new_user = User(
        name=body.name, username=body.username or None, email=body.email,
        password=hash_password(body.password or "changeme123"),
        role=body.role or "Viewer", status=body.status or "Active",
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

    user.name = body.name
    user.username = body.username or None
    user.email = body.email
    user.role = body.role
    user.status = body.status
    if body.password and body.password.strip():
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
