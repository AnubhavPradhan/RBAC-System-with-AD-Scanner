"""
Report routes: summary, user-activity, role-assignment, permission-audit,
security-summary, system-usage, CSV export.
"""
import io, csv
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from database import get_db, User, Role, Permission, AuditLog, role_permissions, ADScanResult
from auth import get_current_user

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.get("/summary")
def summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.status == "Active").count()
    total_roles = db.query(Role).count()
    total_permissions = db.query(Permission).count()
    total_logs = db.query(AuditLog).count()
    critical_events = db.query(AuditLog).filter(AuditLog.severity == "Critical").count()
    warning_events = db.query(AuditLog).filter(AuditLog.severity == "Warning").count()
    failed_logins = db.query(AuditLog).filter(AuditLog.action == "Failed Login").count()

    # AD Scanner summary (latest scan)
    latest_scan = db.query(ADScanResult).order_by(ADScanResult.id.desc()).first()
    ad_summary = None
    if latest_scan:
        ad_summary = {
            "total_ad_users": latest_scan.total_users,
            "high_risk_accounts": latest_scan.high_risk_count,
            "privileged_accounts": latest_scan.privileged_users,
            "stale_accounts": latest_scan.stale_accounts,
            "scan_timestamp": str(latest_scan.scan_timestamp),
        }

    return {
        "totalUsers": total_users,
        "activeUsers": active_users,
        "totalRoles": total_roles,
        "totalPermissions": total_permissions,
        "totalLogs": total_logs,
        "criticalEvents": critical_events,
        "warningEvents": warning_events,
        "failedLogins": failed_logins,
        "adSummary": ad_summary,
    }


@router.get("/user-activity")
def user_activity(
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog).filter(AuditLog.action.in_(["Login", "Logout", "Failed Login"]))
    if dateFrom:
        q = q.filter(AuditLog.timestamp >= dateFrom)
    if dateTo:
        q = q.filter(AuditLog.timestamp <= dateTo + " 23:59:59")
    logs = q.order_by(AuditLog.id.desc()).limit(500).all()
    return [
        {"id": l.id, "timestamp": str(l.timestamp), "user_email": l.user_email,
         "action": l.action, "resource": l.resource, "details": l.details, "severity": l.severity}
        for l in logs
    ]


@router.get("/role-assignment")
def role_assignment(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    roles = db.query(Role).all()
    result = []
    for r in roles:
        count = db.query(User).filter(User.role == r.name).count()
        result.append({"role": r.name, "description": r.description, "user_count": count})
    return result


@router.get("/permission-audit")
def permission_audit(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    perms = db.query(Permission).all()
    result = []
    for p in perms:
        role_count = len(p.roles)
        result.append({"name": p.name, "description": p.description, "category": p.category,
                       "status": p.status, "role_count": role_count})
    return result


@router.get("/security-summary")
def security_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(AuditLog.action, AuditLog.severity, func.count().label("count"))
        .filter(AuditLog.severity.in_(["Critical", "Warning"]))
        .group_by(AuditLog.action, AuditLog.severity)
        .order_by(func.count().desc())
        .all()
    )
    return [{"action": r.action, "severity": r.severity, "count": r.count} for r in rows]


@router.get("/system-usage")
def system_usage(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(AuditLog.action, func.count().label("count"))
        .group_by(AuditLog.action)
        .order_by(func.count().desc())
        .all()
    )
    return [{"action": r.action, "count": r.count} for r in rows]


@router.get("/export/csv")
def export_csv(
    type: str = Query("users"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    output = io.StringIO()
    writer = csv.writer(output)

    if type == "user-activity":
        logs = db.query(AuditLog).order_by(AuditLog.id.desc()).all()
        writer.writerow(["id", "timestamp", "user", "action", "resource", "details", "severity"])
        for l in logs:
            writer.writerow([l.id, str(l.timestamp), l.user_email, l.action, l.resource, l.details, l.severity])
        filename = "user-activity-report.csv"
    elif type == "role-assignment":
        roles = db.query(Role).all()
        writer.writerow(["role", "description", "user_count"])
        for r in roles:
            count = db.query(User).filter(User.role == r.name).count()
            writer.writerow([r.name, r.description, count])
        filename = "role-assignment-report.csv"
    elif type == "permission-audit":
        perms = db.query(Permission).all()
        writer.writerow(["name", "description", "category", "status", "role_count"])
        for p in perms:
            writer.writerow([p.name, p.description, p.category, p.status, len(p.roles)])
        filename = "permission-audit-report.csv"
    elif type == "security-summary":
        rows = (
            db.query(AuditLog.action, AuditLog.severity, func.count().label("count"))
            .filter(AuditLog.severity.in_(["Critical", "Warning"]))
            .group_by(AuditLog.action, AuditLog.severity).all()
        )
        writer.writerow(["action", "severity", "event_count"])
        for r in rows:
            writer.writerow([r.action, r.severity, r.count])
        filename = "security-summary-report.csv"
    else:
        users = db.query(User).all()
        writer.writerow(["id", "name", "email", "role", "status", "created_at"])
        for u in users:
            writer.writerow([u.id, u.name, u.email, u.role, u.status, str(u.created_at)])
        filename = "users-report.csv"

    output.seek(0)
    return StreamingResponse(
        output, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
