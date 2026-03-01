"""
Core AD scanner: tries real LDAP first, falls back to mock data.
"""
import json
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from config import settings
from database import ADScanResult, ADUser, AuditLog
from ad_scanner.mock_ad import generate_mock_ad_users
from ad_scanner.risk_engine import analyze_user_risk, generate_risk_summary


def _try_ldap_scan(db: Session = None) -> Optional[list[dict]]:
    """
    Attempt to connect to a real AD via LDAP/LDAPS and enumerate users.
    First checks DB for web-UI-configured connection, then falls back to env vars.
    Returns None if not configured or connection fails.
    """
    ad_server = settings.AD_SERVER
    ad_port = settings.AD_PORT
    ad_use_ssl = settings.AD_USE_SSL
    ad_base_dn = settings.AD_BASE_DN
    ad_bind_user = settings.AD_BIND_USER
    ad_bind_password = settings.AD_BIND_PASSWORD

    # Override with DB config if available
    if db:
        from database import ADConnectionConfig
        cfg = db.query(ADConnectionConfig).first()
        if cfg and cfg.is_connected:
            ad_server = cfg.server
            ad_port = cfg.port
            ad_use_ssl = cfg.use_ssl
            ad_base_dn = cfg.base_dn
            ad_bind_user = cfg.bind_user
            ad_bind_password = cfg.bind_password

    if not ad_server or not ad_bind_user:
        return None

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl

        tls_config = None
        if ad_use_ssl:
            tls_config = Tls(validate=ssl.CERT_NONE)

        server = Server(
            ad_server,
            port=ad_port,
            use_ssl=ad_use_ssl,
            tls=tls_config,
            get_info=ALL,
        )

        conn = Connection(
            server,
            user=ad_bind_user,
            password=ad_bind_password,
            auto_bind=True,
        )

        # Search for all user objects
        conn.search(
            search_base=ad_base_dn,
            search_filter="(&(objectClass=user)(objectCategory=person))",
            search_scope=SUBTREE,
            attributes=[
                "sAMAccountName", "displayName", "mail", "userAccountControl",
                "lastLogonTimestamp", "pwdLastSet", "description", "memberOf",
            ],
        )

        users = []
        for entry in conn.entries:
            attrs = entry.entry_attributes_as_dict

            # Parse userAccountControl flags
            uac = int(attrs.get("userAccountControl", [512])[0])
            enabled = not bool(uac & 0x0002)          # ACCOUNTDISABLE
            pwd_never_expires = bool(uac & 0x10000)    # DONT_EXPIRE_PASSWORD

            # Parse memberOf
            groups = []
            for dn in attrs.get("memberOf", []):
                # Extract CN from DN
                cn = str(dn).split(",")[0].replace("CN=", "")
                groups.append(cn)

            # Parse timestamps
            last_logon = None
            ll_raw = attrs.get("lastLogonTimestamp", [None])[0]
            if ll_raw:
                try:
                    last_logon = ll_raw.isoformat() if hasattr(ll_raw, "isoformat") else str(ll_raw)
                except:
                    pass

            pwd_set = None
            ps_raw = attrs.get("pwdLastSet", [None])[0]
            if ps_raw:
                try:
                    pwd_set = ps_raw.isoformat() if hasattr(ps_raw, "isoformat") else str(ps_raw)
                except:
                    pass

            privileged_groups = {
                "Domain Admins", "Enterprise Admins", "Administrators",
                "Backup Operators", "Schema Admins", "Account Operators",
            }
            is_priv = bool(set(groups) & privileged_groups)
            is_orphaned = (not enabled) and is_priv

            # Stale check
            is_stale = False
            if last_logon:
                try:
                    from datetime import timedelta
                    logon_dt = datetime.fromisoformat(last_logon.replace("Z", "+00:00"))
                    if (datetime.utcnow() - logon_dt.replace(tzinfo=None)).days > settings.STALE_ACCOUNT_DAYS:
                        is_stale = True
                except:
                    pass

            users.append({
                "sam_account_name": str(attrs.get("sAMAccountName", [""])[0]),
                "display_name": str(attrs.get("displayName", [""])[0]),
                "email": str(attrs.get("mail", [""])[0]),
                "enabled": enabled,
                "last_logon": last_logon,
                "password_last_set": pwd_set,
                "password_never_expires": pwd_never_expires,
                "description": str(attrs.get("description", [""])[0]),
                "member_of": groups,
                "is_privileged": is_priv,
                "is_stale": is_stale,
                "is_orphaned": is_orphaned,
            })

        conn.unbind()
        return users if users else None

    except ImportError:
        print("ldap3 not installed, falling back to mock data")
        return None
    except Exception as e:
        print(f"LDAP connection failed: {e}")
        return None


def run_scan(db: Session, triggered_by: str = "system") -> dict:
    """
    Run a full AD scan:
    1. Try LDAP → fall back to mock
    2. Analyze risks
    3. Save to database
    4. Return results
    """
    start = time.time()

    # ── Get AD users ──
    source = "ldap"
    raw_users = _try_ldap_scan(db=db)
    if raw_users is None:
        source = "mock"
        raw_users = generate_mock_ad_users(count=50)

    # ── Analyze each user ──
    analyzed_users = [analyze_user_risk(u) for u in raw_users]

    # ── Aggregate summary ──
    summary = generate_risk_summary(analyzed_users)
    elapsed_ms = int((time.time() - start) * 1000)

    # ── Save scan result ──
    scan = ADScanResult(
        total_users=summary["total_users"],
        enabled_users=summary["enabled_users"],
        disabled_users=summary["disabled_users"],
        privileged_users=summary["privileged_users"],
        stale_accounts=summary["stale_accounts"],
        password_never_expires=summary["password_never_expires"],
        inactive_accounts=summary["inactive_accounts"],
        orphaned_accounts=summary["orphaned_accounts"],
        weak_config_count=summary["weak_config_count"],
        high_risk_count=summary["high_risk_count"],
        scan_duration_ms=elapsed_ms,
        scan_source=source,
    )
    db.add(scan)
    db.flush()

    # ── Save individual AD user records ──
    for u in analyzed_users:
        ad_user = ADUser(
            scan_id=scan.id,
            sam_account_name=u["sam_account_name"],
            display_name=u["display_name"],
            email=u.get("email", ""),
            enabled=u.get("enabled", True),
            last_logon=datetime.fromisoformat(u["last_logon"]) if u.get("last_logon") else None,
            password_last_set=datetime.fromisoformat(u["password_last_set"]) if u.get("password_last_set") else None,
            password_never_expires=u.get("password_never_expires", False),
            description=u.get("description", ""),
            member_of=json.dumps(u.get("member_of", [])),
            is_privileged=u.get("is_privileged", False),
            is_stale=u.get("is_stale", False),
            is_inactive=u.get("is_inactive", False),
            is_orphaned=u.get("is_orphaned", False),
            risk_level=u.get("risk_level", "Low"),
            risk_flags=json.dumps(u.get("risk_flags", [])),
        )
        db.add(ad_user)

    # ── Audit log ──
    db.add(AuditLog(
        user_email=triggered_by,
        action="AD Scan",
        resource="AD Scanner",
        details=f"Scanned {summary['total_users']} AD users ({source}). "
                f"High risk: {summary['high_risk_count']}, Privileged: {summary['privileged_users']}",
        severity="Info",
    ))

    db.commit()

    return {
        "scan_id": scan.id,
        "scan_timestamp": str(scan.scan_timestamp),
        "scan_source": source,
        "scan_duration_ms": elapsed_ms,
        "summary": summary,
        "users": analyzed_users,
    }
