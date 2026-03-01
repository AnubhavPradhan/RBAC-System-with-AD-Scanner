"""
Risk analysis engine for AD scan results.
Evaluates each AD user and assigns risk levels & flags.
"""
import json
from datetime import datetime, timedelta
from config import settings

PRIVILEGED_GROUPS = {
    "Domain Admins", "Enterprise Admins", "Administrators",
    "Backup Operators", "Schema Admins", "Account Operators",
}


def analyze_user_risk(user: dict) -> dict:
    """
    Accepts an AD user dict and returns it enriched with:
      - risk_level: Low / Medium / High / Critical
      - risk_flags: list of string descriptions
      - is_inactive: bool
    """
    flags = []
    score = 0  # accumulate risk score

    # 1. Password never expires
    if user.get("password_never_expires"):
        flags.append("Password never expires")
        score += 25

    # 2. Stale account (no logon > threshold days)
    last_logon = user.get("last_logon")
    is_inactive = False
    if last_logon:
        try:
            logon_dt = datetime.fromisoformat(last_logon)
            days_since = (datetime.utcnow() - logon_dt).days
            if days_since > settings.STALE_ACCOUNT_DAYS:
                flags.append(f"Inactive for {days_since} days")
                score += 20
                is_inactive = True
        except (ValueError, TypeError):
            pass

    # 3. Member of privileged groups
    groups = set(user.get("member_of", []))
    priv_groups = groups & PRIVILEGED_GROUPS
    if priv_groups:
        flags.append(f"Member of: {', '.join(priv_groups)}")
        score += 15 * len(priv_groups)

    # 4. Blank description
    if not user.get("description", "").strip():
        flags.append("Blank description")
        score += 5

    # 5. Disabled account still in privileged groups (orphaned)
    if not user.get("enabled", True) and priv_groups:
        flags.append("Disabled but in privileged groups (orphaned)")
        score += 30

    # 6. Password age check
    pwd_set = user.get("password_last_set")
    if pwd_set:
        try:
            pwd_dt = datetime.fromisoformat(pwd_set)
            pwd_age = (datetime.utcnow() - pwd_dt).days
            if pwd_age > settings.PASSWORD_EXPIRY_DAYS:
                flags.append(f"Password {pwd_age} days old")
                score += 15
        except (ValueError, TypeError):
            pass

    # 7. Disabled but enabled flag mismatch (sanity)
    if not user.get("enabled", True) and not priv_groups:
        # Disabled non-privileged - low concern but note it
        if "Disabled account" not in [f for f in flags]:
            flags.append("Account disabled")
            score += 2

    # ── Determine risk level from score ──
    if score >= 60:
        risk_level = "Critical"
    elif score >= 35:
        risk_level = "High"
    elif score >= 15:
        risk_level = "Medium"
    else:
        risk_level = "Low"

    return {
        **user,
        "risk_level": risk_level,
        "risk_flags": flags,
        "is_inactive": is_inactive,
    }


def generate_risk_summary(analyzed_users: list[dict]) -> dict:
    """Aggregate risk statistics from a list of analyzed users."""
    total = len(analyzed_users)
    enabled = sum(1 for u in analyzed_users if u.get("enabled"))
    disabled = total - enabled
    privileged = sum(1 for u in analyzed_users if u.get("is_privileged"))
    stale = sum(1 for u in analyzed_users if u.get("is_stale"))
    inactive = sum(1 for u in analyzed_users if u.get("is_inactive"))
    pwd_never_exp = sum(1 for u in analyzed_users if u.get("password_never_expires"))
    orphaned = sum(1 for u in analyzed_users if u.get("is_orphaned"))
    blank_desc = sum(1 for u in analyzed_users if not u.get("description", "").strip())

    critical = sum(1 for u in analyzed_users if u.get("risk_level") == "Critical")
    high = sum(1 for u in analyzed_users if u.get("risk_level") == "High")
    medium = sum(1 for u in analyzed_users if u.get("risk_level") == "Medium")
    low = sum(1 for u in analyzed_users if u.get("risk_level") == "Low")

    high_risk = critical + high

    # Breakdown by risk type for the dashboard table
    risk_breakdown = [
        {"risk_type": "Inactive Users (>90 days)", "count": inactive, "severity": "High"},
        {"risk_type": "Password Never Expires", "count": pwd_never_exp, "severity": "High"},
        {"risk_type": "Privileged Accounts", "count": privileged, "severity": "Critical"},
        {"risk_type": "Orphaned Accounts", "count": orphaned, "severity": "Critical"},
        {"risk_type": "Stale Accounts", "count": stale, "severity": "Medium"},
        {"risk_type": "Blank Description", "count": blank_desc, "severity": "Low"},
        {"risk_type": "Disabled Accounts", "count": disabled, "severity": "Info"},
    ]

    return {
        "total_users": total,
        "enabled_users": enabled,
        "disabled_users": disabled,
        "privileged_users": privileged,
        "stale_accounts": stale,
        "inactive_accounts": inactive,
        "password_never_expires": pwd_never_exp,
        "orphaned_accounts": orphaned,
        "weak_config_count": pwd_never_exp + blank_desc,
        "high_risk_count": high_risk,
        "risk_levels": {"critical": critical, "high": high, "medium": medium, "low": low},
        "risk_breakdown": risk_breakdown,
    }
