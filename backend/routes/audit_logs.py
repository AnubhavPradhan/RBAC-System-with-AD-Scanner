"""
Audit log routes.
"""
import io, csv
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, AuditLog, User
from auth import get_current_user

router = APIRouter(prefix="/api/audit-logs", tags=["Audit Logs"])


class AuditLogCreate(BaseModel):
    action: str
    resource: Optional[str] = ""
    details: Optional[str] = ""
    severity: Optional[str] = "Info"


@router.get("")
def list_audit_logs(
    action: Optional[str] = None,
    user: Optional[str] = None,
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog)
    if action and action != "All":
        q = q.filter(AuditLog.action == action)
    if user:
        q = q.filter(AuditLog.user_email.ilike(f"%{user}%"))
    if dateFrom:
        q = q.filter(AuditLog.timestamp >= dateFrom)
    if dateTo:
        q = q.filter(AuditLog.timestamp <= dateTo + " 23:59:59")
    logs = q.order_by(AuditLog.id.desc()).limit(1000).all()
    return [
        {"id": l.id, "timestamp": str(l.timestamp), "user_email": l.user_email,
         "action": l.action, "resource": l.resource, "details": l.details, "severity": l.severity}
        for l in logs
    ]


@router.post("", status_code=201)
def create_audit_log(body: AuditLogCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log = AuditLog(
        user_email=current_user.email, action=body.action,
        resource=body.resource or "", details=body.details or "",
        severity=body.severity or "Info",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return {"id": log.id, "timestamp": str(log.timestamp), "user_email": log.user_email,
            "action": log.action, "resource": log.resource, "details": log.details, "severity": log.severity}


@router.delete("")
def clear_audit_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(AuditLog).delete()
    db.commit()
    return {"message": "All audit logs cleared"}


@router.get("/export/csv")
def export_csv(
    action: Optional[str] = None,
    user: Optional[str] = None,
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog)
    if action and action != "All":
        q = q.filter(AuditLog.action == action)
    if user:
        q = q.filter(AuditLog.user_email.ilike(f"%{user}%"))
    if dateFrom:
        q = q.filter(AuditLog.timestamp >= dateFrom)
    if dateTo:
        q = q.filter(AuditLog.timestamp <= dateTo + " 23:59:59")
    logs = q.order_by(AuditLog.id.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Timestamp", "User", "Action", "Resource", "Details", "Severity"])
    for l in logs:
        writer.writerow([l.id, str(l.timestamp), l.user_email, l.action, l.resource, l.details, l.severity])
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-logs.csv"'},
    )
