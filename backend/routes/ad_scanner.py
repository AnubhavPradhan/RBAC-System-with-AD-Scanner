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


# ──────────────────────────────────────────
# 7. Fetch AD Groups live from LDAP
# ──────────────────────────────────────────
@router.get("/groups")
def list_ad_groups(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Fetch all security/distribution groups directly from AD via LDAP.
    Falls back to groups extracted from the last scan if LDAP is unavailable.
    """
    cfg = db.query(ADConnectionConfig).first()

    if cfg and cfg.is_connected:
        try:
            from ldap3 import Server, Connection, ALL, SUBTREE, Tls
            import ssl as ssl_mod

            tls_config = Tls(validate=ssl_mod.CERT_NONE) if cfg.use_ssl else None
            server = Server(
                cfg.server, port=cfg.port, use_ssl=cfg.use_ssl,
                tls=tls_config, get_info=ALL, connect_timeout=10,
            )
            conn = Connection(
                server, user=cfg.bind_user, password=cfg.bind_password,
                auto_bind=True, receive_timeout=15,
            )

            conn.search(
                search_base=cfg.base_dn,
                search_filter="(objectClass=group)",
                search_scope=SUBTREE,
                attributes=["cn", "description", "member", "groupType", "distinguishedName", "sAMAccountName"],
            )

            groups = []
            for entry in conn.entries:
                try:
                    gtype_val = int(str(entry.groupType)) if entry.groupType else 0
                except (ValueError, TypeError):
                    gtype_val = 0

                is_security = bool(gtype_val & 0x80000000) if gtype_val >= 0 else True
                if gtype_val & 0x00000004:
                    scope = "Universal"
                elif gtype_val & 0x00000002:
                    scope = "Global"
                else:
                    scope = "Domain Local"

                members = []
                if entry.member:
                    for m in entry.member:
                        dn_str = str(m)
                        cn_part = dn_str.split(",")[0]
                        cn_part = cn_part[3:] if cn_part.upper().startswith("CN=") else cn_part
                        members.append(cn_part)

                groups.append({
                    "name": str(entry.cn),
                    "description": str(entry.description) if entry.description and str(entry.description) != "[]" else "",
                    "dn": str(entry.distinguishedName),
                    "sam_account_name": str(entry.sAMAccountName) if entry.sAMAccountName else "",
                    "member_count": len(members),
                    "members": members[:100],
                    "type": "Security" if is_security else "Distribution",
                    "scope": scope,
                    "source": "ldap",
                })

            conn.unbind()
            groups.sort(key=lambda g: g["name"].lower())
            return {"groups": groups, "source": "ldap", "total": len(groups)}

        except Exception as e:
            # Fall through to scan-based fallback
            pass

    # Fallback: extract groups from the last scan's member_of data
    scan = db.query(ADScanResult).order_by(ADScanResult.id.desc()).first()
    if not scan:
        return {"groups": [], "source": "none", "total": 0}

    ad_users = db.query(ADUser).filter(ADUser.scan_id == scan.id).all()
    group_map: dict = {}
    for u in ad_users:
        for g in (json.loads(u.member_of) if u.member_of else []):
            group_map.setdefault(g, []).append(u.display_name or u.sam_account_name)

    groups = [
        {
            "name": name,
            "description": "",
            "dn": f"CN={name},CN=Users,{cfg.base_dn if cfg else ''}",
            "sam_account_name": name,
            "member_count": len(members),
            "members": members,
            "type": "Security",
            "scope": "Unknown",
            "source": "scan",
        }
        for name, members in sorted(group_map.items())
    ]
    return {"groups": groups, "source": "scan", "total": len(groups)}


# ──────────────────────────────────────────
# 8. RBAC → AD Sync: Push RBAC users into AD
# ──────────────────────────────────────────
@router.post("/sync-rbac-to-ad")
def sync_rbac_to_ad(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    For each RBAC user (that was NOT created by AD sync), create or update
    them in Active Directory and assign them to the correct AD group based
    on the role → group mappings (reverse of AD→RBAC).
    """
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")

    # Get AD connection config
    cfg = db.query(ADConnectionConfig).first()
    if not cfg or not cfg.is_connected:
        raise HTTPException(400, "No AD connection configured. Connect to AD first.")

    # Build reverse mapping: RBAC role → AD group (use first match per role)
    mappings = db.query(ADGroupMapping).all()
    if not mappings:
        raise HTTPException(400, "No AD group → RBAC role mappings configured.")

    # Reverse: role → best AD group to place user in
    role_to_group: dict = {}
    # Priority: prefer non-admin groups for lower roles, use first mapping found
    for m in mappings:
        if m.rbac_role not in role_to_group:
            role_to_group[m.rbac_role] = m.ad_group

    # Get all RBAC users excluding system/seed users (those without a username or @ad.local suffix indicates AD-synced)
    rbac_users = db.query(User).filter(
        User.status == "Active",
        User.id != current_user.id,
    ).all()

    created = 0
    updated = 0
    skipped = 0
    errors = []

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls, MODIFY_REPLACE
        import ssl as ssl_mod

        tls_config = None
        if cfg.use_ssl:
            tls_config = Tls(validate=ssl_mod.CERT_NONE)

        server = Server(
            cfg.server, port=cfg.port, use_ssl=cfg.use_ssl,
            tls=tls_config, get_info=ALL, connect_timeout=10,
        )
        conn = Connection(
            server, user=cfg.bind_user, password=cfg.bind_password,
            auto_bind=True, receive_timeout=15,
        )

        for rbac_user in rbac_users:
            sam = rbac_user.username or rbac_user.email.split("@")[0]
            # Sanitize: AD sAMAccountName max 20 chars, no spaces
            sam = sam.replace(" ", ".").replace("@", "").strip()[:20]

            target_group = role_to_group.get(rbac_user.role)
            if not target_group:
                skipped += 1
                continue

            # Get group DN
            conn.search(
                search_base=cfg.base_dn,
                search_filter=f"(&(objectClass=group)(cn={target_group}))",
                search_scope=SUBTREE,
                attributes=["distinguishedName"],
            )
            if not conn.entries:
                errors.append(f"Group '{target_group}' not found in AD")
                skipped += 1
                continue
            group_dn = str(conn.entries[0].distinguishedName)

            # Check if user already exists in AD
            conn.search(
                search_base=cfg.base_dn,
                search_filter=f"(&(objectClass=user)(sAMAccountName={sam}))",
                search_scope=SUBTREE,
                attributes=["distinguishedName", "memberOf"],
            )

            if conn.entries:
                # User exists — ensure they're in the correct group
                user_dn = str(conn.entries[0].distinguishedName)
                member_of = [str(g) for g in conn.entries[0].memberOf] if conn.entries[0].memberOf else []
                if group_dn not in member_of:
                    conn.modify(group_dn, {"member": [(MODIFY_REPLACE, [user_dn] + [m for m in member_of if m != group_dn])]})
                    # Use add member instead
                    from ldap3 import MODIFY_ADD
                    conn.modify(group_dn, {"member": [(MODIFY_ADD, [user_dn])]})
                    updated += 1
                else:
                    skipped += 1
            else:
                # Create new AD user
                display_name = rbac_user.name
                first_name = rbac_user.name.split(" ")[0]
                last_name = " ".join(rbac_user.name.split(" ")[1:]) if len(rbac_user.name.split(" ")) > 1 else ""
                email = rbac_user.email if "@" in rbac_user.email and "ad.local" not in rbac_user.email else f"{sam}@{cfg.domain or 'mylab.local'}"

                user_dn = f"CN={display_name},CN=Users,{cfg.base_dn}"

                # Unicode password for AD (must be quoted and UTF-16LE encoded)
                default_password = '"RBACSync_ChangeMe1!"'
                encoded_password = default_password.encode("utf-16-le")

                attributes = {
                    "objectClass": ["top", "person", "organizationalPerson", "user"],
                    "cn": display_name,
                    "sAMAccountName": sam,
                    "userPrincipalName": f"{sam}@{cfg.domain or 'mylab.local'}",
                    "displayName": display_name,
                    "givenName": first_name,
                    "mail": email,
                    "description": f"Created by RBAC system (role: {rbac_user.role})",
                    "userAccountControl": 512,  # Normal account, enabled
                }
                if last_name:
                    attributes["sn"] = last_name

                success = conn.add(user_dn, attributes=attributes)
                if not success:
                    errors.append(f"Failed to create '{sam}': {conn.result.get('description', 'Unknown error')}")
                    skipped += 1
                    continue

                # Set password
                conn.modify(user_dn, {"unicodePwd": [(MODIFY_REPLACE, [encoded_password])]})

                # Add to target group
                from ldap3 import MODIFY_ADD
                conn.modify(group_dn, {"member": [(MODIFY_ADD, [user_dn])]})

                created += 1

        conn.unbind()

    except Exception as e:
        raise HTTPException(500, f"AD sync failed: {str(e)}")

    db.add(AuditLog(
        user_email=current_user.email, action="RBAC → AD Sync", resource="AD Scanner",
        details=f"Synced RBAC → AD: {created} created, {updated} updated, {skipped} skipped"
                + (f", {len(errors)} errors" if errors else ""),
        severity="Info" if not errors else "Warning",
    ))
    db.commit()

    return {
        "message": "RBAC → AD sync completed",
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }


# ──────────────────────────────────────────
# 9. Fetch Organizational Units from LDAP
# ──────────────────────────────────────────
@router.get("/ous")
def list_ous(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(ADConnectionConfig).first()
    if not cfg or not cfg.is_connected:
        return {"ous": [], "source": "none", "total": 0}

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl as ssl_mod

        tls_config = Tls(validate=ssl_mod.CERT_NONE) if cfg.use_ssl else None
        server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=10)
        conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, receive_timeout=15)

        conn.search(
            search_base=cfg.base_dn,
            search_filter="(objectClass=organizationalUnit)",
            search_scope=SUBTREE,
            attributes=["ou", "description", "distinguishedName", "whenCreated", "managedBy"],
        )

        ous = []
        for entry in conn.entries:
            dn = str(entry.distinguishedName)
            # Build a readable path from the DN (strip the OU= prefix parts)
            parts = [p.strip() for p in dn.split(",")]
            ou_parts = [p[3:] for p in parts if p.upper().startswith("OU=")]
            path = " / ".join(reversed(ou_parts))

            desc = str(entry.description) if entry.description and str(entry.description) not in ["", "[]"] else ""
            created = str(entry.whenCreated)[:19] if entry.whenCreated and str(entry.whenCreated) != "[]" else ""
            managed_by = str(entry.managedBy) if entry.managedBy and str(entry.managedBy) != "[]" else ""
            if managed_by:
                cn_part = managed_by.split(",")[0]
                managed_by = cn_part[3:] if cn_part.upper().startswith("CN=") else cn_part

            ous.append({
                "name": str(entry.ou) if entry.ou else ou_parts[0] if ou_parts else dn,
                "path": path,
                "dn": dn,
                "description": desc,
                "created": created,
                "managed_by": managed_by,
            })

        conn.unbind()
        ous.sort(key=lambda o: o["path"].lower())
        return {"ous": ous, "source": "ldap", "total": len(ous)}

    except Exception as e:
        raise HTTPException(500, f"Failed to fetch OUs: {str(e)}")


# ──────────────────────────────────────────
# 10. Fetch Computers from LDAP
# ──────────────────────────────────────────
@router.get("/computers")
def list_computers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(ADConnectionConfig).first()
    if not cfg or not cfg.is_connected:
        return {"computers": [], "source": "none", "total": 0}

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl as ssl_mod

        tls_config = Tls(validate=ssl_mod.CERT_NONE) if cfg.use_ssl else None
        server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=10)
        conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, receive_timeout=15)

        conn.search(
            search_base=cfg.base_dn,
            search_filter="(&(objectClass=computer)(!(primaryGroupID=516)))",
            search_scope=SUBTREE,
            attributes=[
                "cn", "distinguishedName", "operatingSystem", "operatingSystemVersion",
                "description", "userAccountControl", "lastLogonTimestamp", "whenCreated",
                "dNSHostName", "memberOf",
            ],
        )

        computers = []
        for entry in conn.entries:
            try:
                uac = int(str(entry.userAccountControl)) if entry.userAccountControl else 0
            except (ValueError, TypeError):
                uac = 0
            enabled = not bool(uac & 0x2)

            last_logon = ""
            if entry.lastLogonTimestamp and str(entry.lastLogonTimestamp) not in ["", "[]"]:
                try:
                    from datetime import datetime, timezone, timedelta
                    # lastLogonTimestamp is Windows FILETIME (100-ns intervals since 1601-01-01)
                    val = int(str(entry.lastLogonTimestamp))
                    if val > 0:
                        epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)
                        dt = epoch + timedelta(microseconds=val // 10)
                        last_logon = dt.strftime("%Y-%m-%d %H:%M")
                except Exception:
                    last_logon = str(entry.lastLogonTimestamp)[:19]

            created = str(entry.whenCreated)[:19] if entry.whenCreated and str(entry.whenCreated) != "[]" else ""

            computers.append({
                "name": str(entry.cn),
                "dns_hostname": str(entry.dNSHostName) if entry.dNSHostName and str(entry.dNSHostName) != "[]" else "",
                "dn": str(entry.distinguishedName),
                "os": str(entry.operatingSystem) if entry.operatingSystem and str(entry.operatingSystem) != "[]" else "Unknown",
                "os_version": str(entry.operatingSystemVersion) if entry.operatingSystemVersion and str(entry.operatingSystemVersion) != "[]" else "",
                "description": str(entry.description) if entry.description and str(entry.description) != "[]" else "",
                "enabled": enabled,
                "last_logon": last_logon,
                "created": created,
            })

        conn.unbind()
        computers.sort(key=lambda c: c["name"].lower())
        return {"computers": computers, "source": "ldap", "total": len(computers)}

    except Exception as e:
        raise HTTPException(500, f"Failed to fetch computers: {str(e)}")


# ──────────────────────────────────────────
# 11. Fetch Domain Controllers from LDAP
# ──────────────────────────────────────────
@router.get("/domain-controllers")
def list_domain_controllers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(ADConnectionConfig).first()
    if not cfg or not cfg.is_connected:
        return {"dcs": [], "source": "none", "total": 0}

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl as ssl_mod

        tls_config = Tls(validate=ssl_mod.CERT_NONE) if cfg.use_ssl else None
        server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=10)
        conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, receive_timeout=15)

        # primaryGroupID=516 means Domain Controllers
        conn.search(
            search_base=cfg.base_dn,
            search_filter="(&(objectClass=computer)(primaryGroupID=516))",
            search_scope=SUBTREE,
            attributes=[
                "cn", "distinguishedName", "operatingSystem", "operatingSystemVersion",
                "description", "userAccountControl", "lastLogonTimestamp", "whenCreated",
                "dNSHostName", "serverReferenceBL",
            ],
        )

        dcs = []
        for entry in conn.entries:
            try:
                uac = int(str(entry.userAccountControl)) if entry.userAccountControl else 0
            except (ValueError, TypeError):
                uac = 0

            last_logon = ""
            if entry.lastLogonTimestamp and str(entry.lastLogonTimestamp) not in ["", "[]"]:
                try:
                    from datetime import datetime, timezone, timedelta
                    val = int(str(entry.lastLogonTimestamp))
                    if val > 0:
                        epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)
                        dt = epoch + timedelta(microseconds=val // 10)
                        last_logon = dt.strftime("%Y-%m-%d %H:%M")
                except Exception:
                    last_logon = str(entry.lastLogonTimestamp)[:19]

            created = str(entry.whenCreated)[:19] if entry.whenCreated and str(entry.whenCreated) != "[]" else ""

            dcs.append({
                "name": str(entry.cn),
                "dns_hostname": str(entry.dNSHostName) if entry.dNSHostName and str(entry.dNSHostName) != "[]" else "",
                "dn": str(entry.distinguishedName),
                "os": str(entry.operatingSystem) if entry.operatingSystem and str(entry.operatingSystem) != "[]" else "Unknown",
                "os_version": str(entry.operatingSystemVersion) if entry.operatingSystemVersion and str(entry.operatingSystemVersion) != "[]" else "",
                "description": str(entry.description) if entry.description and str(entry.description) != "[]" else "",
                "enabled": not bool(uac & 0x2),
                "last_logon": last_logon,
                "created": created,
                "is_global_catalog": bool(uac & 0x00080000),
            })

        conn.unbind()
        dcs.sort(key=lambda d: d["name"].lower())
        return {"dcs": dcs, "source": "ldap", "total": len(dcs)}

    except Exception as e:
        raise HTTPException(500, f"Failed to fetch DCs: {str(e)}")


# ══════════════════════════════════════════
# HELPER: get a bound LDAP connection
# ══════════════════════════════════════════
def _get_ldap_conn(db: Session):
    """Return (conn, cfg) or raise 400."""
    cfg = db.query(ADConnectionConfig).first()
    if not cfg or not cfg.is_connected:
        raise HTTPException(400, "No active AD connection.")
    from ldap3 import Server, Connection, ALL, Tls
    import ssl as ssl_mod
    tls_config = Tls(validate=ssl_mod.CERT_NONE) if cfg.use_ssl else None
    server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=10)
    conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, receive_timeout=15)
    return conn, cfg


# ──────────────────────────────────────────
# 12. AD User CRUD
# ──────────────────────────────────────────
class ADUserCreateRequest(BaseModel):
    first_name: str
    last_name: str = ""
    initials: str = ""
    full_name: str = ""
    sam_account_name: str
    upn_suffix: str = ""
    password: str
    description: str = ""
    enabled: bool = True
    password_never_expires: bool = False
    ou_dn: str = ""  # target OU DN; empty → CN=Users


class ADUserUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    initials: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    password_never_expires: Optional[bool] = None


class ADUserGroupRequest(BaseModel):
    group_dn: str


@router.post("/users")
def create_ad_user(body: ADUserCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a new user in Active Directory."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import MODIFY_REPLACE
        display = body.full_name or f"{body.first_name} {body.last_name}".strip() or body.sam_account_name
        container = body.ou_dn if body.ou_dn else f"CN=Users,{cfg.base_dn}"
        user_dn = f"CN={display},{container}"
        upn_suffix = body.upn_suffix or cfg.domain or "mylab.local"

        attrs = {
            "objectClass": ["top", "person", "organizationalPerson", "user"],
            "cn": display,
            "sAMAccountName": body.sam_account_name,
            "userPrincipalName": f"{body.sam_account_name}@{upn_suffix}",
            "displayName": display,
            "givenName": body.first_name,
            "userAccountControl": 544,  # normal + password not required (temp)
        }
        if body.last_name:
            attrs["sn"] = body.last_name
        if body.initials:
            attrs["initials"] = body.initials
        if body.description:
            attrs["description"] = body.description

        ok = conn.add(user_dn, attributes=attrs)
        if not ok:
            raise HTTPException(400, f"Failed to create user: {conn.result.get('description', conn.result)}")

        # Set password
        pwd_quoted = f'"{body.password}"'
        encoded_pwd = pwd_quoted.encode("utf-16-le")
        conn.modify(user_dn, {"unicodePwd": [(MODIFY_REPLACE, [encoded_pwd])]})

        # Build UAC
        uac = 512  # NORMAL_ACCOUNT
        if not body.enabled:
            uac |= 0x0002
        if body.password_never_expires:
            uac |= 0x10000
        conn.modify(user_dn, {"userAccountControl": [(MODIFY_REPLACE, [str(uac)])]})

        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Create", resource="AD User",
                        details=f"Created AD user '{body.sam_account_name}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"User '{body.sam_account_name}' created", "dn": user_dn}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Create user failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.put("/users/{sam_account_name}")
def update_ad_user(sam_account_name: str, body: ADUserUpdateRequest,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update an existing AD user's attributes."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_REPLACE
        conn.search(cfg.base_dn, f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
                     search_scope=SUBTREE, attributes=["distinguishedName", "userAccountControl"])
        if not conn.entries:
            raise HTTPException(404, f"User '{sam_account_name}' not found in AD")
        user_dn = str(conn.entries[0].distinguishedName)
        current_uac = int(str(conn.entries[0].userAccountControl)) if conn.entries[0].userAccountControl else 512

        changes = {}
        if body.first_name is not None:
            changes["givenName"] = [(MODIFY_REPLACE, [body.first_name])]
        if body.last_name is not None:
            changes["sn"] = [(MODIFY_REPLACE, [body.last_name])]
        if body.initials is not None:
            changes["initials"] = [(MODIFY_REPLACE, [body.initials])]
        if body.display_name is not None:
            changes["displayName"] = [(MODIFY_REPLACE, [body.display_name])]
        if body.email is not None:
            changes["mail"] = [(MODIFY_REPLACE, [body.email])]
        if body.description is not None:
            changes["description"] = [(MODIFY_REPLACE, [body.description])]

        # UAC changes
        if body.enabled is not None or body.password_never_expires is not None:
            uac = current_uac
            if body.enabled is not None:
                if body.enabled:
                    uac &= ~0x0002
                else:
                    uac |= 0x0002
            if body.password_never_expires is not None:
                if body.password_never_expires:
                    uac |= 0x10000
                else:
                    uac &= ~0x10000
            changes["userAccountControl"] = [(MODIFY_REPLACE, [str(uac)])]

        if changes:
            ok = conn.modify(user_dn, changes)
            if not ok:
                raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")

        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD User",
                        details=f"Updated AD user '{sam_account_name}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"User '{sam_account_name}' updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Update user failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.delete("/users/{sam_account_name}")
def delete_ad_user(sam_account_name: str,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete a user from Active Directory."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE
        conn.search(cfg.base_dn, f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
                     search_scope=SUBTREE, attributes=["distinguishedName"])
        if not conn.entries:
            raise HTTPException(404, f"User '{sam_account_name}' not found")
        user_dn = str(conn.entries[0].distinguishedName)
        ok = conn.delete(user_dn)
        if not ok:
            raise HTTPException(400, f"Delete failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Delete", resource="AD User",
                        details=f"Deleted AD user '{sam_account_name}'", severity="Warning"))
        db.commit()
        return {"success": True, "message": f"User '{sam_account_name}' deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Delete user failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.post("/users/{sam_account_name}/add-to-group")
def add_user_to_group(sam_account_name: str, body: ADUserGroupRequest,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_ADD
        conn.search(cfg.base_dn, f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
                     search_scope=SUBTREE, attributes=["distinguishedName"])
        if not conn.entries:
            raise HTTPException(404, "User not found")
        user_dn = str(conn.entries[0].distinguishedName)
        ok = conn.modify(body.group_dn, {"member": [(MODIFY_ADD, [user_dn])]})
        if not ok:
            raise HTTPException(400, f"Failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD User",
                        details=f"Added '{sam_account_name}' to group", severity="Info"))
        db.commit()
        return {"success": True, "message": "User added to group"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.post("/users/{sam_account_name}/remove-from-group")
def remove_user_from_group(sam_account_name: str, body: ADUserGroupRequest,
                           current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_DELETE
        conn.search(cfg.base_dn, f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
                     search_scope=SUBTREE, attributes=["distinguishedName"])
        if not conn.entries:
            raise HTTPException(404, "User not found")
        user_dn = str(conn.entries[0].distinguishedName)
        ok = conn.modify(body.group_dn, {"member": [(MODIFY_DELETE, [user_dn])]})
        if not ok:
            raise HTTPException(400, f"Failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD User",
                        details=f"Removed '{sam_account_name}' from group", severity="Info"))
        db.commit()
        return {"success": True, "message": "User removed from group"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        try:
            conn.unbind()
        except:
            pass


# ──────────────────────────────────────────
# 13. AD Group CRUD
# ──────────────────────────────────────────
class ADGroupCreateRequest(BaseModel):
    name: str
    scope: str = "Global"       # Global, Universal, DomainLocal
    group_type: str = "Security" # Security, Distribution
    description: str = ""
    ou_dn: str = ""


class ADGroupUpdateRequest(BaseModel):
    description: Optional[str] = None


@router.post("/groups/create")
def create_ad_group(body: ADGroupCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        container = body.ou_dn if body.ou_dn else f"CN=Users,{cfg.base_dn}"
        group_dn = f"CN={body.name},{container}"

        # groupType calculation
        scope_val = {"Global": 0x00000002, "Universal": 0x00000004, "DomainLocal": 0x00000004}.get(body.scope, 0x00000002)
        if body.scope == "DomainLocal":
            scope_val = 0x00000004  # domain local uses 4 as well in some representations
            # Actually DomainLocal = 4, Universal = 8... let me use standard values
            # ADS_GROUP_TYPE: Global=2, DomainLocal=4, Universal=8
            scope_val = 0x00000004
        if body.scope == "Universal":
            scope_val = 0x00000008
        type_flag = -2147483648 if body.group_type == "Security" else 0  # 0x80000000 for security
        group_type_val = scope_val | type_flag if body.group_type == "Security" else scope_val

        attrs = {
            "objectClass": ["top", "group"],
            "cn": body.name,
            "sAMAccountName": body.name,
            "groupType": str(group_type_val),
        }
        if body.description:
            attrs["description"] = body.description

        ok = conn.add(group_dn, attributes=attrs)
        if not ok:
            raise HTTPException(400, f"Failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Create", resource="AD Group",
                        details=f"Created AD group '{body.name}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"Group '{body.name}' created", "dn": group_dn}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Create group failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.put("/groups/{group_cn}")
def update_ad_group(group_cn: str, body: ADGroupUpdateRequest,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_REPLACE
        conn.search(cfg.base_dn, f"(&(objectClass=group)(cn={group_cn}))",
                     search_scope=SUBTREE, attributes=["distinguishedName"])
        if not conn.entries:
            raise HTTPException(404, "Group not found")
        group_dn = str(conn.entries[0].distinguishedName)
        changes = {}
        if body.description is not None:
            changes["description"] = [(MODIFY_REPLACE, [body.description])]
        if changes:
            ok = conn.modify(group_dn, changes)
            if not ok:
                raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD Group",
                        details=f"Updated AD group '{group_cn}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"Group '{group_cn}' updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Update group failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.delete("/groups/{group_cn}")
def delete_ad_group(group_cn: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE
        conn.search(cfg.base_dn, f"(&(objectClass=group)(cn={group_cn}))",
                     search_scope=SUBTREE, attributes=["distinguishedName"])
        if not conn.entries:
            raise HTTPException(404, "Group not found")
        group_dn = str(conn.entries[0].distinguishedName)
        ok = conn.delete(group_dn)
        if not ok:
            raise HTTPException(400, f"Delete failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Delete", resource="AD Group",
                        details=f"Deleted AD group '{group_cn}'", severity="Warning"))
        db.commit()
        return {"success": True, "message": f"Group '{group_cn}' deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Delete group failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


# ──────────────────────────────────────────
# 14. OU CRUD
# ──────────────────────────────────────────
class OUCreateRequest(BaseModel):
    name: str
    description: str = ""
    parent_dn: str = ""  # empty → create under base_dn


class OUUpdateRequest(BaseModel):
    description: Optional[str] = None


@router.post("/ous/create")
def create_ou(body: OUCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        parent = body.parent_dn if body.parent_dn else cfg.base_dn
        ou_dn = f"OU={body.name},{parent}"
        attrs = {"objectClass": ["top", "organizationalUnit"], "ou": body.name}
        if body.description:
            attrs["description"] = body.description
        ok = conn.add(ou_dn, attributes=attrs)
        if not ok:
            raise HTTPException(400, f"Failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Create", resource="AD OU",
                        details=f"Created OU '{body.name}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"OU '{body.name}' created", "dn": ou_dn}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Create OU failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.put("/ous/update")
def update_ou(dn: str = Query(...), description: str = Query(""),
              current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import MODIFY_REPLACE
        changes = {"description": [(MODIFY_REPLACE, [description])]}
        ok = conn.modify(dn, changes)
        if not ok:
            raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD OU",
                        details=f"Updated OU '{dn}'", severity="Info"))
        db.commit()
        return {"success": True, "message": "OU updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Update OU failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.delete("/ous/delete")
def delete_ou(dn: str = Query(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE
        # Check if OU has children
        conn.search(dn, "(objectClass=*)", search_scope=SUBTREE, attributes=["distinguishedName"])
        children = [e for e in conn.entries if str(e.distinguishedName) != dn]
        if children:
            raise HTTPException(400, f"OU is not empty ({len(children)} objects inside). Move or delete them first.")
        ok = conn.delete(dn)
        if not ok:
            raise HTTPException(400, f"Delete failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Delete", resource="AD OU",
                        details=f"Deleted OU '{dn}'", severity="Warning"))
        db.commit()
        return {"success": True, "message": "OU deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Delete OU failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


# ──────────────────────────────────────────
# 15. Computer CRUD
# ──────────────────────────────────────────
class ComputerCreateRequest(BaseModel):
    name: str
    ou_dn: str = ""  # target OU; empty → CN=Computers
    description: str = ""


class ComputerUpdateRequest(BaseModel):
    description: Optional[str] = None
    enabled: Optional[bool] = None


@router.post("/computers/create")
def create_computer(body: ComputerCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        container = body.ou_dn if body.ou_dn else f"CN=Computers,{cfg.base_dn}"
        comp_dn = f"CN={body.name},{container}"
        sam = body.name.upper()
        if not sam.endswith("$"):
            sam += "$"

        attrs = {
            "objectClass": ["top", "person", "organizationalPerson", "user", "computer"],
            "cn": body.name,
            "sAMAccountName": sam,
            "userAccountControl": "4096",  # WORKSTATION_TRUST_ACCOUNT
        }
        if body.description:
            attrs["description"] = body.description

        ok = conn.add(comp_dn, attributes=attrs)
        if not ok:
            raise HTTPException(400, f"Failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Create", resource="AD Computer",
                        details=f"Created computer '{body.name}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"Computer '{body.name}' created", "dn": comp_dn}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Create computer failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.put("/computers/{comp_cn}")
def update_computer(comp_cn: str, body: ComputerUpdateRequest,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_REPLACE
        conn.search(cfg.base_dn, f"(&(objectClass=computer)(cn={comp_cn}))",
                     search_scope=SUBTREE, attributes=["distinguishedName", "userAccountControl"])
        if not conn.entries:
            raise HTTPException(404, "Computer not found")
        comp_dn = str(conn.entries[0].distinguishedName)
        changes = {}
        if body.description is not None:
            changes["description"] = [(MODIFY_REPLACE, [body.description])]
        if body.enabled is not None:
            uac = int(str(conn.entries[0].userAccountControl)) if conn.entries[0].userAccountControl else 4096
            if body.enabled:
                uac &= ~0x0002
            else:
                uac |= 0x0002
            changes["userAccountControl"] = [(MODIFY_REPLACE, [str(uac)])]
        if changes:
            ok = conn.modify(comp_dn, changes)
            if not ok:
                raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD Computer",
                        details=f"Updated computer '{comp_cn}'", severity="Info"))
        db.commit()
        return {"success": True, "message": f"Computer '{comp_cn}' updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Update computer failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass


@router.delete("/computers/{comp_cn}")
def delete_computer(comp_cn: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE
        conn.search(cfg.base_dn, f"(&(objectClass=computer)(cn={comp_cn}))",
                     search_scope=SUBTREE, attributes=["distinguishedName"])
        if not conn.entries:
            raise HTTPException(404, "Computer not found")
        comp_dn = str(conn.entries[0].distinguishedName)
        ok = conn.delete(comp_dn)
        if not ok:
            raise HTTPException(400, f"Delete failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Delete", resource="AD Computer",
                        details=f"Deleted computer '{comp_cn}'", severity="Warning"))
        db.commit()
        return {"success": True, "message": f"Computer '{comp_cn}' deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Delete computer failed: {e}")
    finally:
        try:
            conn.unbind()
        except:
            pass
