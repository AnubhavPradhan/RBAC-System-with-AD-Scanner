"""
SQLAlchemy database setup and ORM models.
"""
import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, DateTime, Boolean,
    ForeignKey, Table, event
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from config import settings

# ── Ensure data directory exists ──
data_dir = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(data_dir, exist_ok=True)

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
    echo=False,
)

# Enable WAL + FK for SQLite
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _):
    if "sqlite" in settings.DATABASE_URL:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ── Association table: role <-> permission ──
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    time_restricted = Column(Boolean, default=False)
    allowed_days = Column(String(100), default="Mon,Tue,Wed,Thu,Fri,Sat,Sun")
    access_start_time = Column(String(5), default="00:00")
    access_end_time = Column(String(5), default="23:59")
    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles")


class Permission(Base):
    __tablename__ = "permissions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text, default="")
    category = Column(String(100), default="General")
    status = Column(String(20), default="Active")
    created_at = Column(DateTime, default=datetime.utcnow)
    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    username = Column(String(100), unique=True, nullable=True)
    email = Column(String(200), unique=True, nullable=False)
    password = Column(String(200), nullable=False)
    role = Column(String(100), default="Viewer")
    status = Column(String(20), default="Active")
    time_override_enabled = Column(Boolean, default=False)
    allowed_days = Column(String(100), default="Mon,Tue,Wed,Thu,Fri,Sat,Sun")
    access_start_time = Column(String(5), default="00:00")
    access_end_time = Column(String(5), default="23:59")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    user_email = Column(String(200), default="system")
    action = Column(String(100), nullable=False)
    resource = Column(String(100), default="")
    details = Column(Text, default="")
    severity = Column(String(20), default="Info")


# ── AD Scanner models ──
class ADScanResult(Base):
    __tablename__ = "ad_scan_results"
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_timestamp = Column(DateTime, default=datetime.utcnow)
    total_users = Column(Integer, default=0)
    enabled_users = Column(Integer, default=0)
    disabled_users = Column(Integer, default=0)
    privileged_users = Column(Integer, default=0)
    stale_accounts = Column(Integer, default=0)
    password_never_expires = Column(Integer, default=0)
    inactive_accounts = Column(Integer, default=0)
    orphaned_accounts = Column(Integer, default=0)
    weak_config_count = Column(Integer, default=0)
    high_risk_count = Column(Integer, default=0)
    scan_duration_ms = Column(Integer, default=0)
    scan_source = Column(String(50), default="mock")  # mock | ldap


class ADUser(Base):
    __tablename__ = "ad_users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("ad_scan_results.id", ondelete="CASCADE"))
    sam_account_name = Column(String(200))
    display_name = Column(String(200))
    email = Column(String(200))
    enabled = Column(Boolean, default=True)
    last_logon = Column(DateTime, nullable=True)
    password_last_set = Column(DateTime, nullable=True)
    password_never_expires = Column(Boolean, default=False)
    description = Column(Text, default="")
    member_of = Column(Text, default="")          # JSON array of group names
    is_privileged = Column(Boolean, default=False)
    is_stale = Column(Boolean, default=False)
    is_inactive = Column(Boolean, default=False)
    is_orphaned = Column(Boolean, default=False)
    risk_level = Column(String(20), default="Low")  # Low / Medium / High / Critical
    risk_flags = Column(Text, default="[]")          # JSON array of risk flag strings


class ADGroupMapping(Base):
    """Maps AD group names → RBAC web roles for automatic role assignment."""
    __tablename__ = "ad_group_mappings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    ad_group = Column(String(200), unique=True, nullable=False)
    rbac_role = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ADConnectionConfig(Base):
    """Stores AD connection settings configured via the web UI."""
    __tablename__ = "ad_connection_config"
    id = Column(Integer, primary_key=True, autoincrement=True)
    server = Column(String(300), nullable=False)       # IP or hostname
    port = Column(Integer, default=389)
    use_ssl = Column(Boolean, default=False)
    use_start_tls = Column(Boolean, default=False)     # StartTLS on port 389
    base_dn = Column(String(300), nullable=False)      # e.g. DC=mylab,DC=local
    bind_user = Column(String(300), nullable=False)     # full DN or domain\\user
    bind_password = Column(String(300), nullable=False)
    domain = Column(String(200), default="")            # friendly domain name
    is_connected = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ADNotification(Base):
    __tablename__ = "ad_notifications"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    object_type = Column(String(50), nullable=False)   # user | group | ou | computer
    action = Column(String(50), nullable=False)        # added | edited | deleted
    name = Column(String(300), nullable=False)
    changed_by = Column(String(200), default="system")
    source = Column(String(50), default="app")        # app | ad-server
    details = Column(Text, default="")
    distinguished_name = Column(String(500), default="")


# ── Create all tables ──
def init_db():
    Base.metadata.create_all(bind=engine)
    # Add last_login column if it doesn't exist yet (safe migration for SQLite)
    with engine.connect() as conn:
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE users ADD COLUMN last_login DATETIME"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE ad_connection_config ADD COLUMN use_start_tls BOOLEAN DEFAULT 0"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE roles ADD COLUMN time_restricted BOOLEAN DEFAULT 0"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE roles ADD COLUMN allowed_days VARCHAR(100) DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE roles ADD COLUMN access_start_time VARCHAR(5) DEFAULT '00:00'"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE roles ADD COLUMN access_end_time VARCHAR(5) DEFAULT '23:59'"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE users ADD COLUMN time_override_enabled BOOLEAN DEFAULT 0"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE users ADD COLUMN allowed_days VARCHAR(100) DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE users ADD COLUMN access_start_time VARCHAR(5) DEFAULT '00:00'"))
            conn.commit()
        except Exception:
            pass  # Column already exists
        try:
            conn.execute(__import__('sqlalchemy').text("ALTER TABLE users ADD COLUMN access_end_time VARCHAR(5) DEFAULT '23:59'"))
            conn.commit()
        except Exception:
            pass  # Column already exists


def get_db():
    """FastAPI dependency for DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
