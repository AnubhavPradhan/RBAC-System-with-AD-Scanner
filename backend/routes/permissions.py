"""
Permission CRUD routes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, Permission, Role, User, AuditLog, role_permissions
from auth import get_current_user

router = APIRouter(prefix="/api/permissions", tags=["Permissions"])


def _ensure_manage_settings_permission(db: Session) -> None:
    existing = db.query(Permission).filter(Permission.name == "manage_settings").first()
    if existing:
        return
    db.add(Permission(
        name="manage_settings",
        description="Access and manage application settings",
        category="System",
        status="Active",
    ))
    db.commit()


class PermissionBody(BaseModel):
    name: str
    description: Optional[str] = ""
    category: Optional[str] = "General"
    status: Optional[str] = "Active"


def _perm_dict(db: Session, p: Permission) -> dict:
    used_by = [r.name for r in p.roles]
    return {
        "id": p.id, "name": p.name, "description": p.description,
        "category": p.category, "status": p.status,
        "created_at": str(p.created_at), "usedBy": used_by,
    }


@router.get("")
def list_permissions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _ensure_manage_settings_permission(db)
    perms = db.query(Permission).all()
    return [_perm_dict(db, p) for p in perms]


@router.post("", status_code=201)
def create_permission(body: PermissionBody, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.name:
        raise HTTPException(400, "Permission name is required")
    if db.query(Permission).filter(Permission.name == body.name).first():
        raise HTTPException(409, "Permission already exists")

    perm = Permission(name=body.name, description=body.description or "",
                      category=body.category or "General", status=body.status or "Active")
    db.add(perm)
    db.flush()

    db.add(AuditLog(user_email=current_user.email, action="Create", resource="Permission",
                    details=f"Created permission: {body.name}", severity="Info"))
    db.commit()
    db.refresh(perm)
    return _perm_dict(db, perm)


@router.put("/{perm_id}")
def update_permission(perm_id: int, body: PermissionBody, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    perm = db.query(Permission).filter(Permission.id == perm_id).first()
    if not perm:
        raise HTTPException(404, "Permission not found")

    perm.name = body.name
    perm.description = body.description or ""
    perm.category = body.category or "General"
    perm.status = body.status or "Active"

    db.add(AuditLog(user_email=current_user.email, action="Update", resource="Permission",
                    details=f"Modified permission: {body.name}", severity="Warning"))
    db.commit()
    db.refresh(perm)
    return _perm_dict(db, perm)


@router.delete("/{perm_id}")
def delete_permission(perm_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    perm = db.query(Permission).filter(Permission.id == perm_id).first()
    if not perm:
        raise HTTPException(404, "Permission not found")

    db.add(AuditLog(user_email=current_user.email, action="Delete", resource="Permission",
                    details=f"Deleted permission: {perm.name}", severity="Warning"))
    db.delete(perm)
    db.commit()
    return {"message": "Permission deleted successfully"}
