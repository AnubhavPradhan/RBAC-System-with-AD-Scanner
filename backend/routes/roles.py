"""
Role CRUD routes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from database import get_db, Role, Permission, User, AuditLog, role_permissions
from auth import get_current_user

router = APIRouter(prefix="/api/roles", tags=["Roles"])


class RoleBody(BaseModel):
    name: str
    description: Optional[str] = ""
    permissions: List[str] = []


def _role_dict(db: Session, role: Role) -> dict:
    perm_names = [p.name for p in role.permissions]
    user_count = db.query(User).filter(User.role == role.name).count()
    return {
        "id": role.id, "name": role.name, "description": role.description,
        "created_at": str(role.created_at), "permissions": perm_names, "users": user_count,
    }


@router.get("")
def list_roles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = db.query(Role).all()
    return [_role_dict(db, r) for r in roles]


@router.post("", status_code=201)
def create_role(body: RoleBody, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.name:
        raise HTTPException(400, "Role name is required")
    if db.query(Role).filter(Role.name == body.name).first():
        raise HTTPException(409, "Role already exists")

    role = Role(name=body.name, description=body.description or "")
    db.add(role)
    db.flush()

    if body.permissions:
        perms = db.query(Permission).filter(Permission.name.in_(body.permissions)).all()
        role.permissions = perms

    db.add(AuditLog(user_email=current_user.email, action="Create", resource="Role",
                    details=f"Created role: {body.name}", severity="Info"))
    db.commit()
    db.refresh(role)
    return _role_dict(db, role)


@router.put("/{role_id}")
def update_role(role_id: int, body: RoleBody, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")

    role.name = body.name
    role.description = body.description or ""

    perms = db.query(Permission).filter(Permission.name.in_(body.permissions)).all() if body.permissions else []
    role.permissions = perms

    db.add(AuditLog(user_email=current_user.email, action="Update", resource="Role",
                    details=f"Modified role: {body.name}", severity="Warning"))
    db.commit()
    db.refresh(role)
    return _role_dict(db, role)


@router.delete("/{role_id}")
def delete_role(role_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")

    db.add(AuditLog(user_email=current_user.email, action="Delete", resource="Role",
                    details=f"Deleted role: {role.name}", severity="Warning"))
    db.delete(role)
    db.commit()
    return {"message": "Role deleted successfully"}
