"""
AD Scanner API routes.
"""
import asyncio
import json
import re
import threading
from collections import deque
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List

from database import get_db, User, ADScanResult, ADUser, ADConnectionConfig, AuditLog, ADNotification
from auth import decode_token, get_current_user
from ad_scanner.scanner import run_scan

router = APIRouter(prefix="/api/ad-scanner", tags=["AD Scanner"])

LDAP_CONNECT_TIMEOUT_SECONDS = 3
LDAP_RECEIVE_TIMEOUT_SECONDS = 3
PROTECTED_AD_SYSTEM_ACCOUNTS = {"guest", "krbtgt"}


def _assert_not_protected_system_account(sam_account_name: str) -> None:
    if str(sam_account_name or "").strip().lower() in PROTECTED_AD_SYSTEM_ACCOUNTS:
        raise HTTPException(403, f"Operation blocked for protected AD system account '{sam_account_name}'")


class _NotificationBroker:
    """Simple in-memory pub/sub for AD notifications."""

    def __init__(self) -> None:
        self._subscribers: list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = []
        self._history = deque(maxlen=200)
        self._lock = threading.Lock()

    def subscribe(self) -> tuple[asyncio.Queue, asyncio.AbstractEventLoop]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        loop = asyncio.get_running_loop()
        with self._lock:
            self._subscribers.append((queue, loop))
        return queue, loop

    def unsubscribe(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._subscribers = [
                (q, l) for (q, l) in self._subscribers if q is not queue or l is not loop
            ]

    def publish(self, event: dict) -> None:
        event_payload = dict(event)
        event_payload.setdefault("id", f"evt-{int(datetime.now(timezone.utc).timestamp() * 1000)}")
        event_payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

        with self._lock:
            self._history.appendleft(event_payload)
            subscribers = list(self._subscribers)

        for queue, loop in subscribers:
            def _enqueue(target_queue: asyncio.Queue = queue, payload: dict = event_payload) -> None:
                if target_queue.full():
                    try:
                        target_queue.get_nowait()
                    except Exception:
                        pass
                try:
                    target_queue.put_nowait(payload)
                except Exception:
                    pass

            try:
                loop.call_soon_threadsafe(_enqueue)
            except RuntimeError:
                # Subscriber loop already closed
                continue

    def recent(self, limit: int = 25) -> list[dict]:
        with self._lock:
            return list(self._history)[:max(1, min(limit, 100))]

    def clear(self) -> None:
        with self._lock:
            self._history.clear()


notification_broker = _NotificationBroker()


def _sse_message(event_name: str, payload: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, default=str)}\n\n"


def _parse_ldap_datetime(value) -> Optional[datetime]:
    if value is None:
        return None
    text = str(value).strip()
    if text in {"", "[]", "None"}:
        return None

    if isinstance(value, datetime):
        dt = value
    else:
        dt = None
        for fmt in ("%Y%m%d%H%M%S.0Z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        if dt is None:
            try:
                dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _ldap_generalized_time(dt: datetime) -> str:
    target = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return target.strftime("%Y%m%d%H%M%S.0Z")


def _publish_ad_notification(
    *,
    db: Optional[Session] = None,
    object_type: str,
    action: str,
    name: str,
    changed_by: str,
    source: str,
    details: str = "",
    timestamp: Optional[str] = None,
    distinguished_name: str = "",
) -> dict:
    event = {
        "object_type": object_type,
        "action": action,
        "name": name,
        "changed_by": changed_by,
        "source": source,
        "details": details,
        "distinguished_name": distinguished_name,
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    if db is not None:
        try:
            ts = _parse_ldap_datetime(event["timestamp"])
            db.add(ADNotification(
                timestamp=ts.replace(tzinfo=None) if ts else datetime.utcnow(),
                object_type=event["object_type"],
                action=event["action"],
                name=event["name"],
                changed_by=event.get("changed_by", "system"),
                source=event.get("source", "app"),
                details=event.get("details", ""),
                distinguished_name=event.get("distinguished_name", ""),
            ))
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    notification_broker.publish(event)
    return event


def _collect_directory_changes_since(db: Session, since: datetime, limit: int = 50) -> list[dict]:
    """Poll AD for recent object additions/edits based on whenChanged."""
    try:
        conn, cfg = _get_ldap_conn(db)
    except HTTPException:
        return []

    results: list[dict] = []
    generalized_since = _ldap_generalized_time(since)
    per_type_limit = max(5, min(40, limit // 2))

    specs = [
        {
            "object_type": "user",
            "search_filter": f"(&(objectClass=user)(objectCategory=person)(whenChanged>={generalized_since}))",
            "name_attr": "sAMAccountName",
        },
        {
            "object_type": "group",
            "search_filter": f"(&(objectClass=group)(whenChanged>={generalized_since}))",
            "name_attr": "cn",
        },
        {
            "object_type": "ou",
            "search_filter": f"(&(objectClass=organizationalUnit)(whenChanged>={generalized_since}))",
            "name_attr": "ou",
        },
        {
            "object_type": "computer",
            "search_filter": f"(&(objectClass=computer)(whenChanged>={generalized_since}))",
            "name_attr": "cn",
        },
    ]

    try:
        from ldap3 import SUBTREE

        def _extract_events(entries, spec: dict) -> list[dict]:
            extracted: list[dict] = []
            for entry in entries:
                changed_dt = _parse_ldap_datetime(getattr(entry, "whenChanged", None))
                if not changed_dt or changed_dt <= since:
                    continue

                created_dt = _parse_ldap_datetime(getattr(entry, "whenCreated", None))
                action = "edited"
                if created_dt and abs((changed_dt - created_dt).total_seconds()) <= 90:
                    action = "added"

                raw_name = getattr(entry, spec["name_attr"], None)
                name_value = str(raw_name) if raw_name and str(raw_name) not in {"", "[]"} else "(unknown)"
                dn_value = str(getattr(entry, "distinguishedName", ""))

                extracted.append(
                    {
                        "object_type": spec["object_type"],
                        "action": action,
                        "name": name_value,
                        "changed_by": "domain controller",
                        "source": "ad-server",
                        "details": f"Detected on AD server ({spec['object_type']})",
                        "distinguished_name": dn_value,
                        "timestamp": changed_dt.isoformat().replace("+00:00", "Z"),
                        "dedupe_key": f"{spec['object_type']}|{dn_value}|{changed_dt.isoformat()}|{action}",
                    }
                )
            return extracted

        for spec in specs:
            try:
                # Fast path: filter server-side by whenChanged
                conn.search(
                    search_base=cfg.base_dn,
                    search_filter=spec["search_filter"],
                    search_scope=SUBTREE,
                    attributes=[spec["name_attr"], "distinguishedName", "whenCreated", "whenChanged"],
                    size_limit=per_type_limit,
                )
                events = _extract_events(conn.entries, spec)

                # Fallback: some AD environments don't behave reliably with whenChanged filters
                if not events:
                    conn.search(
                        search_base=cfg.base_dn,
                        search_filter=f"(objectClass={spec['object_type'] if spec['object_type'] != 'ou' else 'organizationalUnit'})",
                        search_scope=SUBTREE,
                        attributes=[spec["name_attr"], "distinguishedName", "whenCreated", "whenChanged"],
                        size_limit=max(per_type_limit * 4, 80),
                    )
                    events = _extract_events(conn.entries, spec)

                results.extend(events)
            except Exception:
                # Continue with other object types even if one search fails
                continue
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    results.sort(key=lambda x: x["timestamp"], reverse=False)
    return results[:limit]


def _collect_current_directory_snapshot(db: Session, limit_per_type: int = 2000) -> dict[str, dict]:
    """Collect a snapshot of current AD objects for delete detection via diffing."""
    try:
        conn, cfg = _get_ldap_conn(db)
    except HTTPException:
        return {}

    snapshot: dict[str, dict] = {}
    specs = [
        {"object_type": "user", "search_filter": "(&(objectClass=user)(objectCategory=person))", "name_attr": "sAMAccountName"},
        {"object_type": "group", "search_filter": "(objectClass=group)", "name_attr": "cn"},
        {"object_type": "ou", "search_filter": "(objectClass=organizationalUnit)", "name_attr": "ou"},
        {"object_type": "computer", "search_filter": "(objectClass=computer)", "name_attr": "cn"},
    ]

    try:
        from ldap3 import SUBTREE

        for spec in specs:
            try:
                conn.search(
                    search_base=cfg.base_dn,
                    search_filter=spec["search_filter"],
                    search_scope=SUBTREE,
                    attributes=[spec["name_attr"], "distinguishedName"],
                    size_limit=limit_per_type,
                )
            except Exception:
                continue

            for entry in conn.entries:
                dn = str(getattr(entry, "distinguishedName", "")).strip()
                if not dn:
                    continue
                raw_name = getattr(entry, spec["name_attr"], None)
                name = str(raw_name) if raw_name and str(raw_name) not in {"", "[]"} else "(unknown)"
                key = f"{spec['object_type']}|{dn}"
                snapshot[key] = {
                    "object_type": spec["object_type"],
                    "name": name,
                    "distinguished_name": dn,
                }
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    return snapshot


@router.get("/notifications/recent")
def recent_notifications(
    limit: int = Query(25, ge=1, le=100),
    object_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")

    q = db.query(ADNotification)
    if object_type:
        q = q.filter(ADNotification.object_type == object_type)
    if action:
        q = q.filter(ADNotification.action == action)

    rows = q.order_by(ADNotification.id.desc()).limit(limit).all()
    items = [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat() + "Z" if r.timestamp else None,
            "object_type": r.object_type,
            "action": r.action,
            "name": r.name,
            "changed_by": r.changed_by,
            "source": r.source,
            "details": r.details,
            "distinguished_name": r.distinguished_name,
        }
        for r in rows
    ]

    if not items:
        items = notification_broker.recent(limit)

    return {"items": items}


@router.delete("/notifications")
def clear_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")

    db.query(ADNotification).delete()
    db.commit()
    notification_broker.clear()
    return {"message": "All AD notifications cleared"}


@router.get("/notifications/stream")
async def stream_notifications(
    request: Request,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    payload = decode_token(token)
    user_id = payload.get("id")
    user = db.query(User).filter(User.id == user_id).first() if user_id else None
    if not user:
        raise HTTPException(401, "User not found")
    if user.role != "Admin":
        raise HTTPException(403, "Admin access required")

    queue, loop = notification_broker.subscribe()
    last_seen = datetime.now(timezone.utc)
    last_poll = 0.0
    previous_snapshot: dict[str, dict] = {}
    seen_keys: deque[str] = deque(maxlen=300)
    seen_key_set: set[str] = set()

    async def event_generator():
        nonlocal last_seen, last_poll
        try:
            try:
                previous_snapshot = _collect_current_directory_snapshot(db)
            except Exception:
                previous_snapshot = {}

            yield _sse_message("connected", {"message": "notification stream connected"})
            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1.2)
                    yield _sse_message("ad-notification", event)
                except asyncio.TimeoutError:
                    pass

                now_monotonic = asyncio.get_running_loop().time()
                if now_monotonic - last_poll >= 4.0:
                    last_poll = now_monotonic
                    try:
                        for change in _collect_directory_changes_since(db, last_seen, limit=40):
                            key = change.pop("dedupe_key", "")
                            if key and key in seen_key_set:
                                continue
                            if key:
                                if len(seen_keys) == seen_keys.maxlen:
                                    oldest = seen_keys.popleft()
                                    seen_key_set.discard(oldest)
                                seen_keys.append(key)
                                seen_key_set.add(key)

                            _publish_ad_notification(
                                db=db,
                                object_type=change["object_type"],
                                action=change["action"],
                                name=change["name"],
                                changed_by=change["changed_by"],
                                source=change["source"],
                                details=change.get("details", ""),
                                timestamp=change.get("timestamp"),
                                distinguished_name=change.get("distinguished_name", ""),
                            )
                            parsed_change_ts = _parse_ldap_datetime(change.get("timestamp"))
                            if parsed_change_ts and parsed_change_ts > last_seen:
                                last_seen = parsed_change_ts

                        # Delete detection: if object existed in previous snapshot and
                        # is missing now, emit an external deleted event.
                        current_snapshot = _collect_current_directory_snapshot(db)
                        removed_keys = [k for k in previous_snapshot.keys() if k not in current_snapshot]
                        for removed_key in removed_keys:
                            removed = previous_snapshot.get(removed_key, {})
                            _publish_ad_notification(
                                db=db,
                                object_type=removed.get("object_type", "user"),
                                action="deleted",
                                name=removed.get("name", "(unknown)"),
                                changed_by="domain controller",
                                source="ad-server",
                                details="Detected deletion on AD server",
                                distinguished_name=removed.get("distinguished_name", ""),
                            )
                        previous_snapshot = current_snapshot
                    except Exception:
                        # Keep stream alive even if polling fails in this cycle
                        pass

                    last_seen = max(last_seen, datetime.now(timezone.utc) - timedelta(minutes=5))
                    yield _sse_message("ping", {"timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")})

                await asyncio.sleep(0.05)
        finally:
            notification_broker.unsubscribe(queue, loop)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────────────────────
# 0. AD Connection Configuration (Web UI)
# ──────────────────────────────────────────
class ADConnectRequest(BaseModel):
    server: str
    port: int = 389
    use_ssl: bool = False
    use_start_tls: bool = False
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
            "use_start_tls": cfg.use_start_tls,
            "base_dn": cfg.base_dn,
            "bind_user": cfg.bind_user,
            "domain": cfg.domain,
            "updated_at": str(cfg.updated_at),
        }
    }


@router.get("/status")
def ad_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return AD connectivity state for UI status badges/cards.

    This endpoint is intentionally non-throwing for offline AD so pages like
    Dashboard can always render without surfacing cross-page connection errors.
    """
    cfg = db.query(ADConnectionConfig).first()
    if not cfg:
        return {
            "configured": False,
            "connected": False,
            "message": "AD connection is not configured",
        }

    if not cfg.is_connected:
        return {
            "configured": True,
            "connected": False,
            "message": "AD connection is configured but currently disconnected",
            "server": cfg.server,
            "port": cfg.port,
        }

    try:
        conn, _ = _get_ldap_conn(db, connect_timeout=2, receive_timeout=2)
        conn.unbind()
        return {
            "configured": True,
            "connected": True,
            "message": "AD server is reachable",
            "server": cfg.server,
            "port": cfg.port,
        }
    except HTTPException as exc:
        return {
            "configured": True,
            "connected": False,
            "message": str(exc.detail),
            "server": cfg.server,
            "port": cfg.port,
        }


@router.post("/test-connection")
def test_connection(body: ADConnectRequest, current_user: User = Depends(get_current_user)):
    """Test AD connection without saving."""
    try:
        from ldap3 import Server, Connection, ALL, Tls
        import ssl as ssl_mod

        tls_config = Tls(validate=ssl_mod.CERT_NONE, version=ssl_mod.PROTOCOL_TLS) if (body.use_ssl or body.use_start_tls) else None

        server = Server(
            body.server,
            port=body.port,
            use_ssl=body.use_ssl,
            tls=tls_config,
            get_info=ALL,
            connect_timeout=LDAP_CONNECT_TIMEOUT_SECONDS,
        )

        auto = 'TLS_BEFORE_BIND' if (body.use_start_tls and not body.use_ssl) else True
        conn = Connection(
            server,
            user=body.bind_user,
            password=body.bind_password,
            auto_bind=auto,
            auto_referrals=False,
            receive_timeout=LDAP_RECEIVE_TIMEOUT_SECONDS,
        )
        enc = 'StartTLS' if body.use_start_tls else ('SSL' if body.use_ssl else 'plain')
        info = server.info
        conn.unbind()
        return {
            "success": True,
            "message": f"Successfully connected to {body.server}:{body.port} ({enc})",
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

        tls_config = Tls(validate=ssl_mod.CERT_NONE, version=ssl_mod.PROTOCOL_TLS) if (body.use_ssl or body.use_start_tls) else None

        server = Server(
            body.server,
            port=body.port,
            use_ssl=body.use_ssl,
            tls=tls_config,
            get_info=ALL,
            connect_timeout=LDAP_CONNECT_TIMEOUT_SECONDS,
        )

        auto = 'TLS_BEFORE_BIND' if (body.use_start_tls and not body.use_ssl) else True
        conn = Connection(
            server,
            user=body.bind_user,
            password=body.bind_password,
            auto_bind=auto,
            auto_referrals=False,
            receive_timeout=LDAP_RECEIVE_TIMEOUT_SECONDS,
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
        cfg.use_start_tls = body.use_start_tls
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
            use_start_tls=body.use_start_tls,
            base_dn=body.base_dn,
            bind_user=body.bind_user,
            bind_password=body.bind_password,
            domain=body.domain,
            is_connected=connected,
        )
        db.add(cfg)

    enc = 'StartTLS' if body.use_start_tls else ('SSL' if body.use_ssl else 'LDAP')
    db.add(AuditLog(
        user_email=current_user.email, action="AD Connect", resource="AD Scanner",
        details=f"Connected to AD server {body.server}:{body.port} ({enc})",
        severity="Info",
    ))
    db.commit()

    return {"success": True, "connected": True, "message": f"Connected to {body.server}:{body.port} ({enc})"}


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


def _dn_to_dns_name(dn: Optional[str]) -> str:
    if not dn:
        return ""
    parts = [part.strip() for part in str(dn).split(",")]
    labels = [part[3:] for part in parts if part.upper().startswith("DC=") and len(part) > 3]
    return ".".join(labels)


@router.get("/upn-suffixes")
def get_upn_suffixes(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return allowed/known UPN suffixes for AD user logon names."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")

    cfg = db.query(ADConnectionConfig).first()
    if not cfg:
        return {"suffixes": ["mylab.local"], "default_suffix": "mylab.local", "source": "default"}

    suffixes: set[str] = set()
    if cfg.domain:
        suffixes.add(cfg.domain.strip().lower())

    if not cfg.is_connected:
        fallback = sorted(suffixes) or ["mylab.local"]
        return {"suffixes": fallback, "default_suffix": fallback[0], "source": "config"}

    conn = None
    try:
        from ldap3 import BASE, SUBTREE

        conn, cfg = _get_ldap_conn(db)

        conn.search(
            search_base="",
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["defaultNamingContext", "configurationNamingContext", "rootDomainNamingContext"],
        )

        default_nc = ""
        configuration_nc = ""
        root_domain_nc = ""
        if conn.entries:
            root_entry = conn.entries[0]
            default_nc = str(getattr(root_entry, "defaultNamingContext", "") or "")
            configuration_nc = str(getattr(root_entry, "configurationNamingContext", "") or "")
            root_domain_nc = str(getattr(root_entry, "rootDomainNamingContext", "") or "")

        for dn_value in (default_nc, root_domain_nc, cfg.base_dn):
            dns_name = _dn_to_dns_name(dn_value)
            if dns_name:
                suffixes.add(dns_name.lower())

        if configuration_nc:
            conn.search(
                search_base=f"CN=Partitions,{configuration_nc}",
                search_filter="(objectClass=crossRef)",
                search_scope=SUBTREE,
                attributes=["uPNSuffixes", "nCName"],
            )
            for entry in conn.entries:
                upn_suffixes = getattr(entry, "uPNSuffixes", None)
                if upn_suffixes:
                    for value in upn_suffixes:
                        text = str(value).strip().lower()
                        if text and text != "[]":
                            suffixes.add(text)

                nc_name = str(getattr(entry, "nCName", "") or "")
                dns_name = _dn_to_dns_name(nc_name)
                if dns_name:
                    suffixes.add(dns_name.lower())

        resolved = sorted(suffixes) or ["mylab.local"]
        return {"suffixes": resolved, "default_suffix": resolved[0], "source": "ldap"}
    except Exception:
        resolved = sorted(suffixes) or ["mylab.local"]
        return {"suffixes": resolved, "default_suffix": resolved[0], "source": "fallback"}
    finally:
        try:
            if conn is not None:
                conn.unbind()
        except Exception:
            pass


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
                tls=tls_config, get_info=ALL, connect_timeout=LDAP_CONNECT_TIMEOUT_SECONDS,
            )
            conn = Connection(
                server, user=cfg.bind_user, password=cfg.bind_password,
                auto_bind=True, auto_referrals=False, receive_timeout=LDAP_RECEIVE_TIMEOUT_SECONDS,
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
        server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=LDAP_CONNECT_TIMEOUT_SECONDS)
        conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, auto_referrals=False, receive_timeout=LDAP_RECEIVE_TIMEOUT_SECONDS)

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
        server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=LDAP_CONNECT_TIMEOUT_SECONDS)
        conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, auto_referrals=False, receive_timeout=LDAP_RECEIVE_TIMEOUT_SECONDS)

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
        server = Server(cfg.server, port=cfg.port, use_ssl=cfg.use_ssl, tls=tls_config, get_info=ALL, connect_timeout=LDAP_CONNECT_TIMEOUT_SECONDS)
        conn = Connection(server, user=cfg.bind_user, password=cfg.bind_password, auto_bind=True, auto_referrals=False, receive_timeout=LDAP_RECEIVE_TIMEOUT_SECONDS)

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
def _get_ldap_conn(
    db: Session,
    connect_timeout: int = LDAP_CONNECT_TIMEOUT_SECONDS,
    receive_timeout: int = LDAP_RECEIVE_TIMEOUT_SECONDS,
):
    """Return (conn, cfg) or raise 400."""
    cfg = db.query(ADConnectionConfig).first()
    if not cfg or not cfg.is_connected:
        raise HTTPException(503, "AD server offline or not configured")
    from ldap3 import Server, Connection, ALL, Tls
    import ssl as ssl_mod
    tls_config = Tls(validate=ssl_mod.CERT_NONE, version=ssl_mod.PROTOCOL_TLS) if (cfg.use_ssl or cfg.use_start_tls) else None
    server = Server(
        cfg.server,
        port=cfg.port,
        use_ssl=cfg.use_ssl,
        tls=tls_config,
        get_info=ALL,
        connect_timeout=connect_timeout,
    )
    auto = 'TLS_BEFORE_BIND' if (cfg.use_start_tls and not cfg.use_ssl) else True
    try:
        conn = Connection(
            server,
            user=cfg.bind_user,
            password=cfg.bind_password,
            auto_bind=auto,
            auto_referrals=False,
            receive_timeout=receive_timeout,
        )
        return conn, cfg
    except Exception:
        # Mark stale connection state so UI can immediately reflect offline AD.
        cfg.is_connected = False
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(503, "AD server offline")


# ──────────────────────────────────────────
# 12. AD User CRUD
# ──────────────────────────────────────────
class ADUserCreateRequest(BaseModel):
    first_name: str
    last_name: str = ""
    initials: str = ""
    full_name: str = ""
    user_logon_name: Optional[str] = None
    pre_windows_logon_name: Optional[str] = None
    sam_account_name: str
    upn_suffix: str = ""
    password: str
    description: str = ""
    enabled: bool = True
    user_must_change_password_next_logon: bool = False
    user_cannot_change_password: bool = False
    password_never_expires: bool = False
    logon_to_all_computers: bool = True
    logon_workstations: list[str] = Field(default_factory=list)
    ou_dn: str = ""  # target OU DN; empty → CN=Users


class ADUserUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    initials: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    user_logon_name: Optional[str] = None
    pre_windows_logon_name: Optional[str] = None
    upn_suffix: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    user_must_change_password_next_logon: Optional[bool] = None
    user_cannot_change_password: Optional[bool] = None
    password_never_expires: Optional[bool] = None
    logon_to_all_computers: Optional[bool] = None
    logon_workstations: Optional[list[str]] = None


class ADUserGroupRequest(BaseModel):
    group_dn: str


def _normalize_workstation_list(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    cleaned: list[str] = []
    seen = set()
    for value in values:
        text = str(value).strip().upper()
        if not text or text in seen:
            continue
        seen.add(text)
        cleaned.append(text)
    return cleaned


def _split_workstation_value(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return _normalize_workstation_list([part for part in str(value).split(",")])


def _build_user_uac(*, current_uac: int = 512, enabled: Optional[bool] = None,
                    password_never_expires: Optional[bool] = None,
                    user_cannot_change_password: Optional[bool] = None) -> int:
    uac = current_uac or 512
    if enabled is not None:
        if enabled:
            uac &= ~0x0002
        else:
            uac |= 0x0002
    if password_never_expires is not None:
        if password_never_expires:
            uac |= 0x10000
        else:
            uac &= ~0x10000
    if user_cannot_change_password is not None:
        if user_cannot_change_password:
            uac |= 0x0040
        else:
            uac &= ~0x0040
    return uac


def _get_user_identity_values(body) -> tuple[str, str]:
    upn_name = (getattr(body, "user_logon_name", None) or "").strip() or body.sam_account_name
    pre_windows_name = (getattr(body, "pre_windows_logon_name", None) or "").strip() or body.sam_account_name
    return upn_name, pre_windows_name


@router.post("/users")
def create_ad_user(body: ADUserCreateRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a new user in Active Directory."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import MODIFY_REPLACE, MODIFY_DELETE

        # AD rejects unicodePwd operations over plain LDAP.
        if not (cfg.use_ssl or cfg.use_start_tls):
            raise HTTPException(
                400,
                "User creation requires an encrypted AD connection. Enable StartTLS (recommended) or LDAPS and reconnect.",
            )

        upn_name, pre_windows_name = _get_user_identity_values(body)
        display = body.full_name or f"{body.first_name} {body.last_name}".strip() or body.sam_account_name
        container = body.ou_dn if body.ou_dn else f"CN=Users,{cfg.base_dn}"
        user_dn = f"CN={display},{container}"
        upn_suffix = body.upn_suffix or cfg.domain or "mylab.local"

        attrs = {
            "objectClass": ["top", "person", "organizationalPerson", "user"],
            "cn": display,
            "sAMAccountName": pre_windows_name,
            "userPrincipalName": f"{upn_name}@{upn_suffix}",
            "displayName": display,
            "givenName": body.first_name,
            # Create as disabled first, then set password, then set final UAC.
            # This avoids common AD "unwillingToPerform" errors during add.
            "userAccountControl": 514,
        }
        if body.last_name:
            attrs["sn"] = body.last_name
        if body.initials:
            attrs["initials"] = body.initials
        if body.description:
            attrs["description"] = body.description

        ok = conn.add(user_dn, attributes=attrs)
        if not ok:
            add_err = str(conn.result.get('description', conn.result))
            if add_err.lower() == "unwillingtoperform":
                raise HTTPException(
                    400,
                    "Failed to create user: AD returned unwillingToPerform. Check OU permissions for the bind account and confirm required attributes (name fields) are valid.",
                )
            raise HTTPException(400, f"Failed to create user: {add_err}")

        # Set password (requires LDAPS or StartTLS — AD rejects unicodePwd over plain LDAP)
        pwd_quoted = f'"{body.password}"'
        encoded_pwd = pwd_quoted.encode("utf-16-le")
        pwd_ok = conn.modify(user_dn, {"unicodePwd": [(MODIFY_REPLACE, [encoded_pwd])]})
        if not pwd_ok:
            pwd_err = conn.result.get('description', conn.result)
            # Clean up the user so we don't leave an account with no password
            conn.delete(user_dn)
            if str(pwd_err).lower() == "constraintviolation":
                raise HTTPException(400, "Failed to set password: Password does not meet AD complexity requirements.")
            raise HTTPException(400, f"Failed to set password: {pwd_err}.")

        # Build UAC
        uac = _build_user_uac(
            current_uac=512,
            enabled=body.enabled,
            password_never_expires=body.password_never_expires,
            user_cannot_change_password=body.user_cannot_change_password,
        )
        conn.modify(user_dn, {"userAccountControl": [(MODIFY_REPLACE, [str(uac)])]})

        pwd_last_set_value = "0" if body.user_must_change_password_next_logon else "-1"
        conn.modify(user_dn, {"pwdLastSet": [(MODIFY_REPLACE, [pwd_last_set_value])]})

        workstation_values = _normalize_workstation_list(body.logon_workstations)
        if body.logon_to_all_computers or not workstation_values:
            try:
                conn.modify(user_dn, {"userWorkstations": [(MODIFY_DELETE, [])]})
            except Exception:
                pass
        else:
            conn.modify(user_dn, {"userWorkstations": [(MODIFY_REPLACE, [",".join(workstation_values)])]})

        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Create", resource="AD User",
                        details=f"Created AD user '{body.sam_account_name}'", severity="Info"))
        db.commit()
        _publish_ad_notification(
            db=db,
            object_type="user",
            action="added",
            name=body.sam_account_name,
            changed_by=current_user.email,
            source="app",
            details="Created from AD Scanner UI",
            distinguished_name=user_dn,
        )
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


@router.get("/users/{sam_account_name}")
def get_ad_user_details(sam_account_name: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return editable AD user attributes for the web form."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE
        conn.search(
            cfg.base_dn,
            f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
            search_scope=SUBTREE,
            attributes=[
                "distinguishedName", "givenName", "sn", "initials", "displayName", "mail",
                "userPrincipalName", "sAMAccountName", "description", "userAccountControl",
                "pwdLastSet", "userWorkstations",
            ],
        )
        if not conn.entries:
            raise HTTPException(404, f"User '{sam_account_name}' not found in AD")

        entry = conn.entries[0]
        upn = str(entry.userPrincipalName) if entry.userPrincipalName and str(entry.userPrincipalName) != "[]" else ""
        upn_name = upn.split("@", 1)[0] if "@" in upn else upn
        workstations = _split_workstation_value(str(entry.userWorkstations)) if entry.userWorkstations and str(entry.userWorkstations) != "[]" else []
        uac = int(str(entry.userAccountControl)) if entry.userAccountControl else 512
        password_never_expires = bool(uac & 0x10000)
        user_cannot_change_password = bool(uac & 0x0040)
        must_change_next_logon = str(entry.pwdLastSet) == "0"

        return {
            "sam_account_name": str(entry.sAMAccountName) if entry.sAMAccountName and str(entry.sAMAccountName) != "[]" else sam_account_name,
            "pre_windows_logon_name": str(entry.sAMAccountName) if entry.sAMAccountName and str(entry.sAMAccountName) != "[]" else sam_account_name,
            "user_logon_name": upn_name,
            "upn_suffix": upn.split("@", 1)[1] if "@" in upn else (cfg.domain or ""),
            "first_name": str(entry.givenName) if entry.givenName and str(entry.givenName) != "[]" else "",
            "last_name": str(entry.sn) if entry.sn and str(entry.sn) != "[]" else "",
            "initials": str(entry.initials) if entry.initials and str(entry.initials) != "[]" else "",
            "full_name": str(entry.displayName) if entry.displayName and str(entry.displayName) != "[]" else "",
            "email": str(entry.mail) if entry.mail and str(entry.mail) != "[]" else "",
            "description": str(entry.description) if entry.description and str(entry.description) != "[]" else "",
            "enabled": not bool(uac & 0x0002),
            "user_must_change_password_next_logon": must_change_next_logon,
            "user_cannot_change_password": user_cannot_change_password,
            "password_never_expires": password_never_expires,
            "logon_to_all_computers": not bool(workstations),
            "logon_workstations": workstations,
        }
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
    _assert_not_protected_system_account(sam_account_name)
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_REPLACE, MODIFY_DELETE
        conn.search(cfg.base_dn, f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
                     search_scope=SUBTREE, attributes=["distinguishedName", "userAccountControl", "pwdLastSet", "userWorkstations", "userPrincipalName"])
        if not conn.entries:
            raise HTTPException(404, f"User '{sam_account_name}' not found in AD")
        user_dn = str(conn.entries[0].distinguishedName)
        current_uac = int(str(conn.entries[0].userAccountControl)) if conn.entries[0].userAccountControl else 512
        current_upn = str(conn.entries[0].userPrincipalName) if conn.entries[0].userPrincipalName and str(conn.entries[0].userPrincipalName) != "[]" else ""
        current_upn_suffix = current_upn.split("@", 1)[1] if "@" in current_upn else (cfg.domain or "mylab.local")
        current_upn_name = current_upn.split("@", 1)[0] if "@" in current_upn else sam_account_name
        current_sam = str(conn.entries[0].sAMAccountName) if hasattr(conn.entries[0], "sAMAccountName") and conn.entries[0].sAMAccountName and str(conn.entries[0].sAMAccountName) != "[]" else sam_account_name
        current_workstations = _split_workstation_value(str(conn.entries[0].userWorkstations)) if conn.entries[0].userWorkstations and str(conn.entries[0].userWorkstations) != "[]" else []

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
        if body.user_logon_name is not None or body.pre_windows_logon_name is not None or body.upn_suffix is not None:
            upn_name = (body.user_logon_name or current_upn_name or sam_account_name).strip()
            pre_windows_name = (body.pre_windows_logon_name or current_sam).strip()
            upn_suffix = (body.upn_suffix or current_upn_suffix or cfg.domain or "mylab.local").strip()
            if body.pre_windows_logon_name is not None:
                changes["sAMAccountName"] = [(MODIFY_REPLACE, [pre_windows_name])]
            changes["userPrincipalName"] = [(MODIFY_REPLACE, [f"{upn_name}@{upn_suffix}"])]

        # UAC changes
        if body.enabled is not None or body.password_never_expires is not None or body.user_cannot_change_password is not None:
            uac = _build_user_uac(
                current_uac=current_uac,
                enabled=body.enabled,
                password_never_expires=body.password_never_expires,
                user_cannot_change_password=body.user_cannot_change_password,
            )
            changes["userAccountControl"] = [(MODIFY_REPLACE, [str(uac)])]

        if body.user_must_change_password_next_logon is not None:
            changes["pwdLastSet"] = [(MODIFY_REPLACE, ["0" if body.user_must_change_password_next_logon else "-1"])]

        if body.logon_to_all_computers is not None or body.logon_workstations is not None:
            workstation_values = _normalize_workstation_list(body.logon_workstations) if body.logon_workstations is not None else current_workstations
            if body.logon_to_all_computers or not workstation_values:
                changes["userWorkstations"] = [(MODIFY_DELETE, [])]
            else:
                changes["userWorkstations"] = [(MODIFY_REPLACE, [",".join(workstation_values)])]

        if changes:
            ok = conn.modify(user_dn, changes)
            if not ok:
                raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")

        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD User",
                        details=f"Updated AD user '{sam_account_name}'", severity="Info"))
        db.commit()
        _publish_ad_notification(
            db=db,
            object_type="user",
            action="edited",
            name=sam_account_name,
            changed_by=current_user.email,
            source="app",
            details="Updated from AD Scanner UI",
            distinguished_name=user_dn,
        )
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
    _assert_not_protected_system_account(sam_account_name)
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
        _publish_ad_notification(
            db=db,
            object_type="user",
            action="deleted",
            name=sam_account_name,
            changed_by=current_user.email,
            source="app",
            details="Deleted from AD Scanner UI",
            distinguished_name=user_dn,
        )
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
        _publish_ad_notification(
            db=db,
            object_type="user",
            action="edited",
            name=sam_account_name,
            changed_by=current_user.email,
            source="app",
            details="Updated group membership",
            distinguished_name=user_dn,
        )
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
        _publish_ad_notification(
            db=db,
            object_type="user",
            action="edited",
            name=sam_account_name,
            changed_by=current_user.email,
            source="app",
            details="Updated group membership",
            distinguished_name=user_dn,
        )
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
# Password Reset Endpoint
# ──────────────────────────────────────────
class ADUserPasswordResetRequest(BaseModel):
    sam_account_name: str
    new_password: str


def _map_ad_password_reset_error(conn, secure_channel: bool) -> HTTPException:
    """Translate ldap3 result into a user-actionable HTTP error."""
    result = conn.result or {}
    description = str(result.get("description") or "Unknown error")
    message = str(result.get("message") or "").strip()
    desc_lower = description.lower()
    msg_lower = message.lower()

    if desc_lower in {"constraintviolation", "constraint violation"}:
        return HTTPException(400, "Password does not meet AD complexity/history requirements")

    if desc_lower in {"insufficientaccessrights", "insufficient access rights"} or "access denied" in msg_lower:
        return HTTPException(403, "Access denied. Ensure the AD bind account has 'Reset password' permissions on the target user/OU")

    if desc_lower == "unwillingtoperform":
        ad_data_match = re.search(r"data\s+([0-9a-fA-F]{1,8})", message)
        ad_data_code = ad_data_match.group(1).upper() if ad_data_match else ""

        if not secure_channel:
            return HTTPException(400, "AD rejected password reset because the LDAP session is not encrypted. Use LDAPS (636) or StartTLS.")

        # Common AD extended error diagnostics for password operations.
        if ad_data_code in {"52D", "0000052D"}:
            return HTTPException(400, "Password violates AD policy (length/complexity/history). Choose a stronger password that was not recently used.")
        if ad_data_code in {"5", "00000005"}:
            return HTTPException(403, "Access denied by AD. Delegate 'Reset password' and 'Write lockoutTime/pwdLastSet' permissions to the bind account on the target OU.")
        if ad_data_code in {"56", "00000056"}:
            return HTTPException(400, "AD rejected the password operation. Ensure this is a reset (admin right) and not a change requiring the current password.")

        diag_suffix = f" AD diagnostic code: {ad_data_code}." if ad_data_code else ""
        return HTTPException(
            400,
            "AD returned unwillingToPerform for password reset. This is usually caused by password policy/history restrictions or missing delegated reset permission for the bind account." + diag_suffix,
        )

    if message:
        return HTTPException(400, f"Password reset failed: {description} ({message})")
    return HTTPException(400, f"Password reset failed: {description}")


def _password_contains_identity_fragments(password: str, sam_account_name: str, display_name: str) -> bool:
    """AD policy often rejects passwords containing >=3-char fragments of account/display name."""
    pwd = str(password or "").lower()
    sam = str(sam_account_name or "").lower()
    display = str(display_name or "").lower()

    # Match common AD complexity behavior: contiguous fragments with length >= 3.
    tokens = set()
    for value in (sam.replace('.', ' ').replace('_', ' ').replace('-', ' '), display):
        for token in value.split():
            t = token.strip()
            if len(t) >= 3:
                tokens.add(t)
    return any(token in pwd for token in tokens)


@router.post("/users/{sam_account_name}/reset-password")
def reset_ad_user_password(sam_account_name: str, body: ADUserPasswordResetRequest,
                           current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Reset an AD user's password. Requires Admin role and SSL/TLS connection."""
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    _assert_not_protected_system_account(sam_account_name)
    
    # Validate password strength
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters long")
    
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import SUBTREE, MODIFY_REPLACE

        # Verify an encrypted channel is actually active (not only configured).
        secure_channel = bool(
            getattr(getattr(conn, "server", None), "ssl", False) or
            getattr(conn, "tls_started", False)
        )
        if not secure_channel:
            raise HTTPException(400, "Password reset requires SSL or StartTLS connection for security")
        
        # Find the user
        conn.search(
            cfg.base_dn,
            f"(&(objectClass=user)(sAMAccountName={sam_account_name}))",
            search_scope=SUBTREE,
            attributes=["distinguishedName", "displayName", "sAMAccountName"],
        )
        if not conn.entries:
            raise HTTPException(404, f"User '{sam_account_name}' not found in AD")
        
        entry = conn.entries[0]
        user_dn = str(entry.distinguishedName)
        resolved_sam = str(entry.sAMAccountName) if getattr(entry, "sAMAccountName", None) else sam_account_name
        resolved_display_name = str(entry.displayName) if getattr(entry, "displayName", None) else ""

        if _password_contains_identity_fragments(body.new_password, resolved_sam, resolved_display_name):
            raise HTTPException(
                400,
                "Password cannot contain parts of the user's account name or display name (minimum 3 consecutive characters).",
            )

        # Prefer AD-native helper for password reset; fallback to unicodePwd replace.
        ok = False
        try:
            ok = conn.extend.microsoft.modify_password(user_dn, body.new_password)
        except Exception:
            ok = False

        if not ok:
            password_bytes = f'"{body.new_password}"'.encode('utf-16-le')
            ok = conn.modify(user_dn, {"unicodePwd": [(MODIFY_REPLACE, [password_bytes])]})

        if not ok:
            raise _map_ad_password_reset_error(conn, secure_channel)
        
        conn.unbind()
        
        # Log the action
        db.add(AuditLog(user_email=current_user.email, action="Reset Password", resource="AD User",
                        details=f"Reset password for AD user '{sam_account_name}'", severity="Info"))
        db.commit()
        
        # Publish notification
        _publish_ad_notification(
            db=db,
            object_type="user",
            action="password_reset",
            name=sam_account_name,
            changed_by=current_user.email,
            source="app",
            details="Password reset from AD Scanner UI",
            distinguished_name=user_dn,
        )
        
        return {"success": True, "message": f"Password reset successfully for user '{sam_account_name}'"}
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Password reset failed: {str(e)}")
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
    name: Optional[str] = None
    scope: Optional[str] = None
    group_type: Optional[str] = None
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
        _publish_ad_notification(
            db=db,
            object_type="group",
            action="added",
            name=body.name,
            changed_by=current_user.email,
            source="app",
            details="Created from AD Scanner UI",
            distinguished_name=group_dn,
        )
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
                     search_scope=SUBTREE, attributes=["distinguishedName", "groupType"])
        if not conn.entries:
            raise HTTPException(404, "Group not found")
        group_dn = str(conn.entries[0].distinguishedName)
        target_cn = (body.name or "").strip() or group_cn

        # Rename group CN first when requested.
        if target_cn != group_cn:
            rename_ok = conn.modify_dn(group_dn, f"CN={target_cn}")
            if not rename_ok:
                raise HTTPException(400, f"Rename failed: {conn.result.get('description', conn.result)}")
            group_dn = _new_dn_with_rdn(group_dn, "CN", target_cn)

        changes = {}
        if body.description is not None:
            changes["description"] = [(MODIFY_REPLACE, [body.description])]

        # Update group scope/type via groupType bitmask.
        current_type_raw = int(str(conn.entries[0].groupType)) if conn.entries[0].groupType else 2
        unsigned_type = current_type_raw if current_type_raw >= 0 else current_type_raw + (1 << 32)
        current_scope = "Global"
        if unsigned_type & 0x00000008:
            current_scope = "Universal"
        elif unsigned_type & 0x00000004:
            current_scope = "DomainLocal"
        current_group_type = "Security" if (unsigned_type & 0x80000000) else "Distribution"

        target_scope = _normalize_group_scope(body.scope) or current_scope
        target_group_type = _normalize_group_type(body.group_type) or current_group_type
        if body.scope is not None or body.group_type is not None:
            changes["groupType"] = [(MODIFY_REPLACE, [_group_type_value(target_scope, target_group_type)])]

        if changes:
            ok = conn.modify(group_dn, changes)
            if not ok:
                raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD Group",
                        details=f"Updated AD group '{group_cn}'" + (f" -> '{target_cn}'" if target_cn != group_cn else ""), severity="Info"))
        db.commit()
        _publish_ad_notification(
            db=db,
            object_type="group",
            action="edited",
            name=target_cn,
            changed_by=current_user.email,
            source="app",
            details="Updated from AD Scanner UI",
            distinguished_name=group_dn,
        )
        return {"success": True, "message": f"Group '{target_cn}' updated"}
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
        _publish_ad_notification(
            db=db,
            object_type="group",
            action="deleted",
            name=group_cn,
            changed_by=current_user.email,
            source="app",
            details="Deleted from AD Scanner UI",
            distinguished_name=group_dn,
        )
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
    name: Optional[str] = None
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
        _publish_ad_notification(
            db=db,
            object_type="ou",
            action="added",
            name=body.name,
            changed_by=current_user.email,
            source="app",
            details="Created from AD Scanner UI",
            distinguished_name=ou_dn,
        )
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
def update_ou(dn: str = Query(...), description: str = Query(""), name: Optional[str] = Query(None),
              current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != "Admin":
        raise HTTPException(403, "Admin access required")
    conn, cfg = _get_ldap_conn(db)
    try:
        from ldap3 import MODIFY_REPLACE
        target_dn = dn

        if name is not None and str(name).strip():
            rename_ok = conn.modify_dn(dn, f"OU={str(name).strip()}")
            if not rename_ok:
                raise HTTPException(400, f"Rename failed: {conn.result.get('description', conn.result)}")
            target_dn = _new_dn_with_rdn(dn, "OU", str(name).strip())

        changes = {"description": [(MODIFY_REPLACE, [description])]}
        ok = conn.modify(target_dn, changes)
        if not ok:
            raise HTTPException(400, f"Update failed: {conn.result.get('description', conn.result)}")
        conn.unbind()
        db.add(AuditLog(user_email=current_user.email, action="Update", resource="AD OU",
                        details=f"Updated OU '{dn}'" + (f" -> '{target_dn}'" if target_dn != dn else ""), severity="Info"))
        db.commit()
        _publish_ad_notification(
            db=db,
            object_type="ou",
            action="edited",
            name=target_dn,
            changed_by=current_user.email,
            source="app",
            details="Updated from AD Scanner UI",
            distinguished_name=target_dn,
        )
        return {"success": True, "message": "OU updated", "dn": target_dn}
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
        _publish_ad_notification(
            db=db,
            object_type="ou",
            action="deleted",
            name=dn,
            changed_by=current_user.email,
            source="app",
            details="Deleted from AD Scanner UI",
            distinguished_name=dn,
        )
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
    name: Optional[str] = None
    dns_hostname: Optional[str] = None
    os: Optional[str] = None
    os_version: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None


def _normalize_group_scope(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower().replace("_", "").replace(" ", "")
    if text in {"global"}:
        return "Global"
    if text in {"domainlocal", "local"}:
        return "DomainLocal"
    if text in {"universal"}:
        return "Universal"
    raise HTTPException(400, "Invalid group scope. Use DomainLocal, Global, or Universal")


def _normalize_group_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower()
    if text == "security":
        return "Security"
    if text == "distribution":
        return "Distribution"
    raise HTTPException(400, "Invalid group type. Use Security or Distribution")


def _group_type_value(scope: str, group_type: str) -> str:
    scope_val = {"Global": 0x00000002, "DomainLocal": 0x00000004, "Universal": 0x00000008}[scope]
    value = scope_val | (0x80000000 if group_type == "Security" else 0)
    # AD expects signed int32 representation for groupType.
    if value >= 0x80000000:
        value -= 0x100000000
    return str(value)


def _new_dn_with_rdn(existing_dn: str, rdn_prefix: str, new_value: str) -> str:
    parts = [p for p in str(existing_dn).split(",") if p]
    if len(parts) < 2:
        raise HTTPException(400, "Invalid distinguishedName")
    return f"{rdn_prefix}={new_value}," + ",".join(parts[1:])


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
        _publish_ad_notification(
            db=db,
            object_type="computer",
            action="added",
            name=body.name,
            changed_by=current_user.email,
            source="app",
            details="Created from AD Scanner UI",
            distinguished_name=comp_dn,
        )
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
        from ldap3 import SUBTREE, MODIFY_REPLACE, MODIFY_DELETE
        conn.search(cfg.base_dn, f"(&(objectClass=computer)(cn={comp_cn}))",
                     search_scope=SUBTREE, attributes=["distinguishedName", "userAccountControl"])
        if not conn.entries:
            raise HTTPException(404, "Computer not found")
        comp_dn = str(conn.entries[0].distinguishedName)
        requested_name = (body.name or "").strip() if body.name is not None else None
        target_name = requested_name or comp_cn

        if requested_name and target_name != comp_cn:
            rename_ok = conn.modify_dn(comp_dn, f"CN={target_name}")
            if not rename_ok:
                raise HTTPException(400, f"Rename failed: {conn.result.get('description', conn.result)}")
            comp_dn = _new_dn_with_rdn(comp_dn, "CN", target_name)

        changes = {}
        if requested_name and target_name != comp_cn:
            sam = target_name.upper()
            if not sam.endswith("$"):
                sam += "$"
            changes["sAMAccountName"] = [(MODIFY_REPLACE, [sam])]
        if body.dns_hostname is not None:
            changes["dNSHostName"] = [(MODIFY_REPLACE, [body.dns_hostname])]
        if body.os is not None:
            changes["operatingSystem"] = [(MODIFY_REPLACE, [body.os])]
        if body.os_version is not None:
            changes["operatingSystemVersion"] = [(MODIFY_REPLACE, [body.os_version])]
        if body.description is not None:
            cleaned_description = body.description.strip()
            if cleaned_description:
                changes["description"] = [(MODIFY_REPLACE, [cleaned_description])]
            else:
                changes["description"] = [(MODIFY_DELETE, [])]
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
                        details=f"Updated computer '{comp_cn}'" + (f" -> '{target_name}'" if target_name != comp_cn else ""), severity="Info"))
        db.commit()
        _publish_ad_notification(
            db=db,
            object_type="computer",
            action="edited",
            name=target_name,
            changed_by=current_user.email,
            source="app",
            details="Updated from AD Scanner UI",
            distinguished_name=comp_dn,
        )
        return {"success": True, "message": f"Computer '{target_name}' updated"}
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
        _publish_ad_notification(
            db=db,
            object_type="computer",
            action="deleted",
            name=comp_cn,
            changed_by=current_user.email,
            source="app",
            details="Deleted from AD Scanner UI",
            distinguished_name=comp_dn,
        )
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



