"""
AD Scanner API routes.
"""
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, User, ADScanResult, ADUser, ADGroupMapping, ADConnectionConfig, AuditLog, Role
from auth import get_current_user
from ad_scanner.scanner import run_scan

router = APIRouter(prefix="/api/ad-scanner", tags=["AD Scanner"])


# ──────────────────────────────────────────
# 0. AD Connection Configuration (Web UI)
# ──────────────────────────────────────────
class ADConnectRequest(BaseModel):
    server: str
    port: int = 389
    use_ssl: bool = False
    base_dn: str
    bind_user: str
    bind_password: str
    domain: str = ""


@router.get("/connection")
def get_connection(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current AD connection config (password masked)."""
    cfg = db.query(ADConnectionConfig).first()
    if not cfg:
        return {"connected": False, "config": None}
    return {
        "connected": cfg.is_connected,
        "config": {
            "server": cfg.server,
            "port": cfg.port,
            "use_ssl": cfg.use_ssl,
            "base_dn": cfg.base_dn,
            "bind_user": cfg.bind_user,
            "domain": cfg.domain,
            "updated_at": str(cfg.updated_at),
        }
    }


@router.post("/test-connection")
def test_connection(body: ADConnectRequest, current_user: User = Depends(get_current_user)):
    """Test AD connection without saving."""
    try:
        from ldap3 import Server, Connection, ALL, Tls
        import ssl as ssl_mod

        tls_config = None
        if body.use_ssl:
            tls_config = Tls(validate=ssl_mod.CERT_NONE)

        server = Server(
            body.server,
            port=body.port,
            use_ssl=body.use_ssl,
            tls=tls_config,
            get_info=ALL,
            connect_timeout=10,
        )
        conn = Connection(
            server,
            user=body.bind_user,
            password=body.bind_password,
            auto_bind=True,
            receive_timeout=10,
        )
        info = server.info
        conn.unbind()
        return {
            "success": True,
            "message": f"Successfully connected to {body.server}:{body.port}",
            "server_info": str(info.naming_contexts) if info else None,
        }
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/connect")
def save_connection(body: ADConnectRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Save AD connection config and test it."""
    # Test first
    try:
        from ldap3 import Server, Connection, ALL, Tls
        import ssl as ssl_mod

        tls_config = None
        if body.use_ssl:
            tls_config = Tls(validate=ssl_mod.CERT_NONE)

        server = Server(
            body.server,
            port=body.port,
            use_ssl=body.use_ssl,
            tls=tls_config,
            get_info=ALL,
            connect_timeout=10,
        )
        conn = Connection(
            server,
            user=body.bind_user,
            password=body.bind_password,
            auto_bind=True,
            receive_timeout=10,
        )
        conn.unbind()
        connected = True
    except Exception as e:
        connected = False
        return {"success": False, "connected": False, "message": f"Connection failed: {str(e)}"}

    # Save to DB
    cfg = db.query(ADConnectionConfig).first()
    if cfg:
        cfg.server = body.server
        cfg.port = body.port
        cfg.use_ssl = body.use_ssl
        cfg.base_dn = body.base_dn
        cfg.bind_user = body.bind_user
        cfg.bind_password = body.bind_password
        cfg.domain = body.domain
        cfg.is_connected = connected
    else:
        cfg = ADConnectionConfig(
            server=body.server,
            port=body.port,
            use_ssl=body.use_ssl,
            base_dn=body.base_dn,
            bind_user=body.bind_user,
            bind_password=body.bind_password,
            domain=body.domain,
            is_connected=connected,
        )
        db.add(cfg)

    db.add(AuditLog(
        user_email=current_user.email, action="AD Connect", resource="AD Scanner",
        details=f"Connected to AD server {body.server}:{body.port} ({'SSL' if body.use_ssl else 'LDAP'})",
        severity="Info",
    ))
    db.commit()

    return {"success": True, "connected": True, "message": f"Connected to {body.server}:{body.port}"}


@router.post("/disconnect")
def disconnect(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove saved AD connection."""
    cfg = db.query(ADConnectionConfig).first()
    if cfg:
        db.delete(cfg)
        db.add(AuditLog(
            user_email=current_user.email, action="AD Disconnect", resource="AD Scanner",
            details="Disconnected from AD server", severity="Info",
        ))
        db.commit()
    return {"success": True, "message": "Disconnected"}


# ──────────────────────────────────────────
# 1. Trigger a new scan
# ──────────────────────────────────────────
@router.post("/scan")
def trigger_scan(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Run a new AD scan (LDAP or mock) and return full results."""
    try:
        result = run_scan(db, triggered_by=current_user.email)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Scan failed: {e}")


# ──────────────────────────────────────────
# 2. List all past scans
# ──────────────────────────────────────────
@router.get("/scans")
def list_scans(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    scans = db.query(ADScanResult).order_by(ADScanResult.id.desc()).limit(50).all()
    return [
        {
            "id": s.id,
            "scan_timestamp": str(s.scan_timestamp),
            "total_users": s.total_users,
            "enabled_users": s.enabled_users,
            "disabled_users": s.disabled_users,
            "privileged_users": s.privileged_users,
            "stale_accounts": s.stale_accounts,
            "password_never_expires": s.password_never_expires,
            "inactive_accounts": s.inactive_accounts,
            "orphaned_accounts": s.orphaned_accounts,
            "weak_config_count": s.weak_config_count,
            "high_risk_count": s.high_risk_count,
            "scan_duration_ms": s.scan_duration_ms,
            "scan_source": s.scan_source,
        }
        for s in scans
    ]


# ──────────────────────────────────────────
# 3. Get latest scan summary (for dashboard)
# ──────────────────────────────────────────
@router.get("/latest")
def latest_scan(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    scan = db.query(ADScanResult).order_by(ADScanResult.id.desc()).first()
    if not scan:
        return {"message": "No scans yet. Run a scan first.", "scan": None, "users": []}

    ad_users = db.query(ADUser).filter(ADUser.scan_id == scan.id).all()
    users_list = [
        {
            "id": u.id,
            "sam_account_name": u.sam_account_name,
            "display_name": u.display_name,
            "email": u.email,
            "enabled": u.enabled,
            "last_logon": str(u.last_logon) if u.last_logon else None,
            "password_last_set": str(u.password_last_set) if u.password_last_set else None,
            "password_never_expires": u.password_never_expires,
            "description": u.description,
            "member_of": json.loads(u.member_of) if u.member_of else [],
            "is_privileged": u.is_privileged,
            "is_stale": u.is_stale,
            "is_inactive": u.is_inactive,
            "is_orphaned": u.is_orphaned,
            "risk_level": u.risk_level,
            "risk_flags": json.loads(u.risk_flags) if u.risk_flags else [],
        }
        for u in ad_users
    ]

    # Build risk breakdown
    from ad_scanner.risk_engine import generate_risk_summary
    risk_summary = generate_risk_summary([
        {
            "sam_account_name": u.sam_account_name,
            "display_name": u.display_name,
            "email": u.email,
            "enabled": u.enabled,
            "last_logon": str(u.last_logon) if u.last_logon else None,
            "password_last_set": str(u.password_last_set) if u.password_last_set else None,
            "password_never_expires": u.password_never_expires,
            "description": u.description or "",
            "member_of": json.loads(u.member_of) if u.member_of else [],
            "is_privileged": u.is_privileged,
            "is_stale": u.is_stale,
            "is_inactive": u.is_inactive,
            "is_orphaned": u.is_orphaned,
            "risk_level": u.risk_level,
            "risk_flags": json.loads(u.risk_flags) if u.risk_flags else [],
        }
        for u in ad_users
    ])

    return {
        "scan": {
            "id": scan.id,
            "scan_timestamp": str(scan.scan_timestamp),
            "total_users": scan.total_users,
            "enabled_users": scan.enabled_users,
            "disabled_users": scan.disabled_users,
            "privileged_users": scan.privileged_users,
            "stale_accounts": scan.stale_accounts,
            "password_never_expires": scan.password_never_expires,
            "inactive_accounts": scan.inactive_accounts,
            "orphaned_accounts": scan.orphaned_accounts,
            "weak_config_count": scan.weak_config_count,
            "high_risk_count": scan.high_risk_count,
            "scan_duration_ms": scan.scan_duration_ms,
            "scan_source": scan.scan_source,
        },
        "users": users_list,
        "risk_breakdown": risk_summary.get("risk_breakdown", []),
        "risk_levels": risk_summary.get("risk_levels", {}),
    }


# ──────────────────────────────────────────
# 4. Get users from a specific scan
# ──────────────────────────────────────────
@router.get("/scans/{scan_id}/users")
def scan_users(
    scan_id: int,
    risk_level: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(ADUser).filter(ADUser.scan_id == scan_id)
    if risk_level:
        q = q.filter(ADUser.risk_level == risk_level)
    ad_users = q.all()
    return [
        {
            "id": u.id,
            "sam_account_name": u.sam_account_name,
            "display_name": u.display_name,
            "email": u.email,
            "enabled": u.enabled,
            "last_logon": str(u.last_logon) if u.last_logon else None,
            "password_last_set": str(u.password_last_set) if u.password_last_set else None,
            "password_never_expires": u.password_never_expires,
            "description": u.description,
            "member_of": json.loads(u.member_of) if u.member_of else [],
            "is_privileged": u.is_privileged,
            "is_stale": u.is_stale,
            "is_inactive": u.is_inactive,
            "is_orphaned": u.is_orphaned,
            "risk_level": u.risk_level,
            "risk_flags": json.loads(u.risk_flags) if u.risk_flags else [],
        }
        for u in ad_users
    ]


# ──────────────────────────────────────────
# 5. AD Group → RBAC Role Mappings
# ──────────────────────────────────────────
class MappingBody(BaseModel):
    ad_group: str
    rbac_role: str


@router.get("/mappings")
def list_mappings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mappings = db.query(ADGroupMapping).all()
    return [
        {"id": m.id, "ad_group": m.ad_group, "rbac_role": m.rbac_role, "created_at": str(m.created_at)}
        for m in mappings
    ]


@router.post("/mappings", status_code=201)
def create_mapping(body: MappingBody, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(ADGroupMapping).filter(ADGroupMapping.ad_group == body.ad_group).first()
    if existing:
        raise HTTPException(409, f"Mapping for '{body.ad_group}' already exists")

    # Validate that the RBAC role exists
    role = db.query(Role).filter(Role.name == body.rbac_role).first()
    if not role:
        raise HTTPException(400, f"RBAC role '{body.rbac_role}' does not exist")

    mapping = ADGroupMapping(ad_group=body.ad_group, rbac_role=body.rbac_role)
    db.add(mapping)
    db.add(AuditLog(
        user_email=current_user.email, action="Create", resource="AD Mapping",
        details=f"Mapped AD group '{body.ad_group}' → RBAC role '{body.rbac_role}'", severity="Info",
    ))
    db.commit()
    db.refresh(mapping)
    return {"id": mapping.id, "ad_group": mapping.ad_group, "rbac_role": mapping.rbac_role, "created_at": str(mapping.created_at)}


@router.put("/mappings/{mapping_id}")
def update_mapping(mapping_id: int, body: MappingBody, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mapping = db.query(ADGroupMapping).filter(ADGroupMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(404, "Mapping not found")

    role = db.query(Role).filter(Role.name == body.rbac_role).first()
    if not role:
        raise HTTPException(400, f"RBAC role '{body.rbac_role}' does not exist")

    mapping.ad_group = body.ad_group
    mapping.rbac_role = body.rbac_role
    db.add(AuditLog(
        user_email=current_user.email, action="Update", resource="AD Mapping",
        details=f"Updated mapping: '{body.ad_group}' → '{body.rbac_role}'", severity="Info",
    ))
    db.commit()
    return {"id": mapping.id, "ad_group": mapping.ad_group, "rbac_role": mapping.rbac_role, "created_at": str(mapping.created_at)}


@router.delete("/mappings/{mapping_id}")
def delete_mapping(mapping_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mapping = db.query(ADGroupMapping).filter(ADGroupMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(404, "Mapping not found")

    db.add(AuditLog(
        user_email=current_user.email, action="Delete", resource="AD Mapping",
        details=f"Deleted mapping: '{mapping.ad_group}' → '{mapping.rbac_role}'", severity="Warning",
    ))
    db.delete(mapping)
    db.commit()
    return {"message": "Mapping deleted successfully"}


# ──────────────────────────────────────────
# 6. Auto-sync: Map AD users → RBAC roles
# ──────────────────────────────────────────
@router.post("/sync-roles")
def sync_ad_roles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Uses the latest AD scan + group mappings to automatically
    create/update RBAC users from AD users.
    """
    scan = db.query(ADScanResult).order_by(ADScanResult.id.desc()).first()
    if not scan:
        raise HTTPException(400, "No AD scan results. Run a scan first.")
    if scan.scan_source == "mock":
        raise HTTPException(400, "Last scan used mock data. Run a real AD scan before syncing.")

    mappings = db.query(ADGroupMapping).all()
    if not mappings:
        raise HTTPException(400, "No AD group → RBAC role mappings configured.")

    mapping_dict = {m.ad_group: m.rbac_role for m in mappings}
    ad_users = db.query(ADUser).filter(ADUser.scan_id == scan.id, ADUser.enabled == True).all()

    created = 0
    updated = 0
    skipped = 0

    for ad_user in ad_users:
        groups = json.loads(ad_user.member_of) if ad_user.member_of else []
        # Find highest-priority matching role
        assigned_role = None
        # Priority: Admin > Editor > Viewer
        role_priority = {"Admin": 3, "Editor": 2, "Viewer": 1}
        best_priority = 0
        for group in groups:
            if group in mapping_dict:
                role = mapping_dict[group]
                priority = role_priority.get(role, 0)
                if priority > best_priority:
                    best_priority = priority
                    assigned_role = role

        if not assigned_role:
            skipped += 1
            continue

        # Check if user already exists in RBAC
        from auth import hash_password
        existing = db.query(User).filter(
            (User.email == ad_user.email) | (User.username == ad_user.sam_account_name)
        ).first()

        if existing:
            if existing.role != assigned_role:
                existing.role = assigned_role
                updated += 1
        else:
            new_user = User(
                name=ad_user.display_name,
                username=ad_user.sam_account_name,
                email=ad_user.email or f"{ad_user.sam_account_name}@ad.local",
                password=hash_password("ADSync_ChangeMe!"),
                role=assigned_role,
                status="Active",
            )
            db.add(new_user)
            created += 1

    db.add(AuditLog(
        user_email=current_user.email, action="AD Role Sync", resource="AD Scanner",
        details=f"Synced AD → RBAC: {created} created, {updated} updated, {skipped} skipped",
        severity="Info",
    ))
    db.commit()

    return {
        "message": "AD role sync completed",
        "created": created,
        "updated": updated,
        "skipped": skipped,
    }
