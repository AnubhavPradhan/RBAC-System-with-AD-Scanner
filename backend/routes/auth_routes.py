"""
Auth routes: login, signup, me, logout
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from datetime import datetime
from database import get_db, User, AuditLog, Role, Permission, role_permissions
from auth import verify_password, hash_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class SignupRequest(BaseModel):
    name: str
    username: Optional[str] = None
    email: str
    password: str
    role: Optional[str] = "Viewer"


def _get_user_permissions(db: Session, role_name: str) -> list[str]:
    rows = (
        db.query(Permission.name)
        .join(role_permissions, Permission.id == role_permissions.c.permission_id)
        .join(Role, Role.id == role_permissions.c.role_id)
        .filter(Role.name == role_name)
        .all()
    )
    return [r[0] for r in rows]


def _user_dict(user: User, permissions: list[str]) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "created_at": str(user.created_at),
        "permissions": permissions,
    }


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    if not body.email or not body.password:
        raise HTTPException(400, "Email and password are required")

    user = (
        db.query(User)
        .filter((User.email == body.email) | (User.username == body.email))
        .first()
    )

    if not user or not verify_password(body.password, user.password):
        db.add(AuditLog(user_email=body.email, action="Failed Login", resource="Auth",
                        details=f"Failed login attempt for: {body.email}", severity="Warning"))
        db.commit()
        raise HTTPException(401, "Invalid email or password")

    if user.status == "Inactive":
        raise HTTPException(403, "Account is inactive. Contact administrator.")

    token = create_access_token({"id": user.id, "email": user.email, "role": user.role, "name": user.name})

    user.last_login = datetime.utcnow()
    db.add(AuditLog(user_email=user.email, action="Login", resource="Auth",
                    details=f"User logged in: {user.email}", severity="Info"))
    db.commit()

    permissions = _get_user_permissions(db, user.role)
    return {"token": token, "user": _user_dict(user, permissions)}


@router.post("/signup")
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    if not body.name or not body.email or not body.password:
        raise HTTPException(400, "Name, email, and password are required")

    existing = db.query(User).filter(
        (User.email == body.email) | (User.username == body.username)
    ).first()
    if existing:
        raise HTTPException(409, "Email or username already exists")

    new_user = User(
        name=body.name,
        username=body.username,
        email=body.email,
        password=hash_password(body.password),
        role=body.role or "Viewer",
        status="Active",
    )
    db.add(new_user)
    db.flush()

    token = create_access_token({"id": new_user.id, "email": new_user.email, "role": new_user.role, "name": new_user.name})

    db.add(AuditLog(user_email=new_user.email, action="Create", resource="Auth",
                    details=f"New user registered: {new_user.email}", severity="Info"))
    db.commit()

    permissions = _get_user_permissions(db, new_user.role)
    return {"token": token, "user": _user_dict(new_user, permissions)}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
        "status": current_user.status,
        "created_at": str(current_user.created_at),
    }


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.add(AuditLog(user_email=current_user.email, action="Logout", resource="Auth",
                    details=f"User logged out: {current_user.email}", severity="Info"))
    db.commit()
    return {"message": "Logged out"}
