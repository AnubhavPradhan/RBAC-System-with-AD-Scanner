"""
Core AD scanner: tries real LDAP first, falls back to mock data.
"""
import json
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config import settings
from database import ADScanResult, ADUser, AuditLog, ADConnectionConfig
from ad_scanner.mock_ad import generate_mock_ad_users
from ad_scanner.risk_engine import analyze_user_risk, generate_risk_summary

logger = logging.getLogger(__name__)


def _normalize_ad_datetime(value) -> Optional[str]:
    """Convert AD timestamp values to ISO-8601 strings when possible."""
    if value is None:
        return None

    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass

    text = str(value).strip()
    if text in {"", "[]", "None", "0"}:
        return None

    # AD FILETIME (100-ns since 1601-01-01 UTC)
    if text.isdigit():
        try:
            raw = int(text)
            if raw <= 0:
                return None
            epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)
            dt = epoch + timedelta(microseconds=raw // 10)
            return dt.isoformat()
        except Exception:
            return None

    # Best-effort parse for already formatted timestamps
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


def _safe_from_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _try_ldap_scan(db: Session = None) -> Optional[list[dict]]:
    """
    Attempt to connect to a real AD via LDAP/LDAPS and enumerate users.
    First checks DB for web-UI-configured connection, then falls back to env vars.
    Returns None if not configured or connection fails.
    """
    ad_server = settings.AD_SERVER
    ad_port = settings.AD_PORT
    ad_use_ssl = settings.AD_USE_SSL
    ad_use_start_tls = getattr(settings, 'AD_USE_START_TLS', False)
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
            ad_use_start_tls = cfg.use_start_tls
            ad_base_dn = cfg.base_dn
            ad_bind_user = cfg.bind_user
            ad_bind_password = cfg.bind_password

    if not ad_server or not ad_bind_user:
        logger.warning("[AD Scanner] No AD server or bind user configured. ad_server=%r, ad_bind_user=%r", ad_server, ad_bind_user)
        return None

    if not ad_base_dn or not ad_base_dn.strip() or "=" not in ad_base_dn:
        logger.error("[AD Scanner] Invalid or empty Base DN: %r  — set it to e.g. DC=mylab,DC=local", ad_base_dn)
        raise ValueError(f"AD Base DN is missing or invalid: {ad_base_dn!r}. Set it to e.g. DC=mylab,DC=local in AD Scanner settings.")

    try:
        from ldap3 import Server, Connection, ALL, SUBTREE, Tls
        import ssl as ssl_mod

        logger.info("[AD Scanner] Connecting to %s:%d (SSL=%s, StartTLS=%s) as %s, base=%s",
                     ad_server, ad_port, ad_use_ssl, ad_use_start_tls, ad_bind_user, ad_base_dn)

        tls_config = None
        if ad_use_ssl or ad_use_start_tls:
            tls_config = Tls(validate=ssl_mod.CERT_NONE, version=ssl_mod.PROTOCOL_TLS)

        server = Server(
            ad_server,
            port=ad_port,
            use_ssl=ad_use_ssl,
            tls=tls_config,
            get_info=ALL,
            connect_timeout=10,
        )

        auto = 'TLS_BEFORE_BIND' if (ad_use_start_tls and not ad_use_ssl) else True
        conn = Connection(
            server,
            user=ad_bind_user,
            password=ad_bind_password,
            auto_bind=auto,
            auto_referrals=False,
            receive_timeout=10,
        )

        logger.info("[AD Scanner] LDAP bound successfully, searching %s", ad_base_dn)

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

            def _get(key, default=""):
                """Safely get first value from an LDAP attribute list."""
                val = attrs.get(key)
                if val and len(val) > 0:
                    return val[0]
                return default

            # Parse userAccountControl flags
            uac = int(_get("userAccountControl", 512))
            enabled = not bool(uac & 0x0002)          # ACCOUNTDISABLE
            pwd_never_expires = bool(uac & 0x10000)    # DONT_EXPIRE_PASSWORD

            # Parse memberOf
            groups = []
            for dn in attrs.get("memberOf", []):
                # Extract CN from DN
                cn = str(dn).split(",")[0].replace("CN=", "")
                groups.append(cn)

            # Parse timestamps
            last_logon = _normalize_ad_datetime(_get("lastLogonTimestamp", None))
            pwd_set = _normalize_ad_datetime(_get("pwdLastSet", None))

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
                    logon_dt = datetime.fromisoformat(last_logon.replace("Z", "+00:00"))
                    if (datetime.utcnow() - logon_dt.replace(tzinfo=None)).days > settings.STALE_ACCOUNT_DAYS:
                        is_stale = True
                except:
                    pass

            users.append({
                "sam_account_name": str(_get("sAMAccountName")),
                "display_name": str(_get("displayName")) or str(_get("sAMAccountName")),
                "email": str(_get("mail")),
                "enabled": enabled,
                "last_logon": last_logon,
                "password_last_set": pwd_set,
                "password_never_expires": pwd_never_expires,
                "description": str(_get("description")),
                "member_of": groups,
                "is_privileged": is_priv,
                "is_stale": is_stale,
                "is_orphaned": is_orphaned,
            })

        conn.unbind()
        logger.info("[AD Scanner] LDAP scan complete: %d users found", len(users))
        return users  # return even if empty — successful LDAP with no results

    except ImportError:
        logger.error("[AD Scanner] ldap3 not installed — cannot scan real AD")
        raise RuntimeError("ldap3 package is not installed on the backend. Install dependencies and restart.")
    except Exception as e:
        logger.error("[AD Scanner] LDAP connection/search failed: %s", e, exc_info=True)
        raise RuntimeError(f"LDAP connection/search failed: {e}")


def _resolve_scan_source(db: Session) -> str:
    """Resolve scan source label based on active connection security settings."""
    use_ssl = bool(getattr(settings, "AD_USE_SSL", False))
    ad_server = str(getattr(settings, "AD_SERVER", "") or "")
    ad_port = int(getattr(settings, "AD_PORT", 389) or 389)

    if ad_server.lower().startswith("ldaps://") or ad_port == 636:
        use_ssl = True

    if db is not None:
        cfg = db.query(ADConnectionConfig).first()
        if cfg and cfg.is_connected:
            server = str(cfg.server or "")
            use_ssl = bool(cfg.use_ssl)
            if server.lower().startswith("ldaps://") or int(cfg.port or 389) == 636:
                use_ssl = True

    return "ldaps" if use_ssl else "ldap"


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
    source = _resolve_scan_source(db)
    raw_users = _try_ldap_scan(db=db)
    if raw_users is None:
        raise RuntimeError("LDAP scan failed. Check your AD connection settings.")

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
            last_logon=_safe_from_iso(u.get("last_logon")),
            password_last_set=_safe_from_iso(u.get("password_last_set")),
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
        details=f"Scanned {summary['total_users']} AD users ({source.upper()}). "
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
