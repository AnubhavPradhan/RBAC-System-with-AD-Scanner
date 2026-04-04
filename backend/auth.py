"""
JWT authentication helpers.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt as _bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from config import settings
from database import get_db, User, Role, AuditLog

security = HTTPBearer()
NEPAL_TZ = timezone(timedelta(hours=5, minutes=45))
ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _parse_hhmm(value: str):
    try:
        hh, mm = value.split(":")
        return int(hh), int(mm)
    except Exception:
        return None


def _is_now_within_window(start_time: str, end_time: str) -> bool:
    start = _parse_hhmm(start_time)
    end = _parse_hhmm(end_time)
    if not start or not end:
        return True

    now = datetime.now(NEPAL_TZ)
    now_minutes = now.hour * 60 + now.minute
    start_minutes = start[0] * 60 + start[1]
    end_minutes = end[0] * 60 + end[1]

    if start_minutes <= end_minutes:
        return start_minutes <= now_minutes <= end_minutes
    return now_minutes >= start_minutes or now_minutes <= end_minutes


def _time_policy_allowed(db: Session, user: User) -> bool:
    now_day = datetime.now(NEPAL_TZ).strftime("%a")

    if user.time_override_enabled:
        days = [d for d in (user.allowed_days or "").split(",") if d]
        allowed_days = days or ALL_DAYS
        if now_day not in allowed_days:
            return False
        return _is_now_within_window(user.access_start_time or "00:00", user.access_end_time or "23:59")

    role = db.query(Role).filter(Role.name == user.role).first()
    if not role or not role.time_restricted:
        return True

    days = [d for d in (role.allowed_days or "").split(",") if d]
    allowed_days = days or ALL_DAYS
    if now_day not in allowed_days:
        return False
    return _is_now_within_window(role.access_start_time or "00:00", role.access_end_time or "23:59")


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def validate_password_strength(password: str) -> tuple[bool, str]:
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if not any(c.isupper() for c in password):
        return False, "Password must include at least one uppercase letter"
    if not any(c.islower() for c in password):
        return False, "Password must include at least one lowercase letter"
    if not any(c.isdigit() for c in password):
        return False, "Password must include at least one number"
    if password.isalnum():
        return False, "Password must include at least one symbol"
    return True, "OK"


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.JWT_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    user_id = payload.get("id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not _time_policy_allowed(db, user):
        db.add(AuditLog(
            user_email=user.email,
            action="Access Denied",
            resource="Auth",
            details="Access denied by time-based policy (Asia/Kathmandu)",
            severity="Warning",
        ))
        db.commit()
        raise HTTPException(status_code=403, detail="Access denied due to time-based policy (NPT)")
    return user
