"""
Configuration settings for the RBAC + AD Scanner backend.
"""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── App ──
    APP_NAME: str = "ERBAC with AD Scanner"
    DEBUG: bool = True

    # ── JWT ──
    JWT_SECRET: str = os.getenv("JWT_SECRET", "rbac_default_secret_key_change_in_production")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 10080  # 7 days

    # ── Database ──
    DATABASE_URL: str = "sqlite:///./data/rbac.db"

    # ── Active Directory / LDAP ──
    AD_SERVER: str = os.getenv("AD_SERVER", "")          # e.g. ldaps://dc.example.com
    AD_PORT: int = int(os.getenv("AD_PORT", "389"))       # 389 for LDAP, 636 for LDAPS
    AD_USE_SSL: bool = os.getenv("AD_USE_SSL", "false").lower() in ("true", "1", "yes")
    AD_USE_START_TLS: bool = os.getenv("AD_USE_START_TLS", "false").lower() in ("true", "1", "yes")
    AD_BASE_DN: str = os.getenv("AD_BASE_DN", "DC=example,DC=com")
    AD_BIND_USER: str = os.getenv("AD_BIND_USER", "")     # service account
    AD_BIND_PASSWORD: str = os.getenv("AD_BIND_PASSWORD", "")
    AD_USE_MOCK: bool = False  # Use simulated AD data when no real AD available

    # ── Risk thresholds ──
    STALE_ACCOUNT_DAYS: int = 90
    PASSWORD_EXPIRY_DAYS: int = 90

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
