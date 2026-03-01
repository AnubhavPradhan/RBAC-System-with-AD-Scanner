"""
Mock Active Directory data generator.
Provides realistic simulated AD users, groups, and misconfigurations
for development/demo when no real AD Domain Controller is available.
"""
import random
from datetime import datetime, timedelta

PRIVILEGED_GROUPS = [
    "Domain Admins",
    "Enterprise Admins",
    "Administrators",
    "Backup Operators",
    "Schema Admins",
    "Account Operators",
]

REGULAR_GROUPS = [
    "Domain Users",
    "Web_Admins",
    "Web_Editors",
    "HR_Department",
    "Finance_Team",
    "IT_Support",
    "Marketing",
    "Sales_Team",
    "Engineering",
    "DevOps",
    "QA_Testers",
    "Management",
]

FIRST_NAMES = [
    "James", "Mary", "Robert", "Jennifer", "Michael", "Linda", "David", "Sarah",
    "William", "Jessica", "John", "Emily", "Richard", "Amanda", "Thomas", "Ashley",
    "Charles", "Stephanie", "Daniel", "Melissa", "Matthew", "Lauren", "Christopher",
    "Rebecca", "Andrew", "Rachel", "Anthony", "Nicole", "Mark", "Samantha",
    "Steven", "Katherine", "Paul", "Elizabeth", "Joshua", "Hannah", "Kevin",
    "Megan", "Brian", "Olivia", "George", "Victoria", "Edward", "Natalie",
    "Timothy", "Grace", "Ronald", "Sophia", "Jason", "Chloe",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
    "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Hill",
    "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell",
    "Mitchell", "Carter", "Roberts", "Phillips",
]


def _random_date(start_days_ago: int, end_days_ago: int = 0) -> datetime:
    """Return a random datetime between start_days_ago and end_days_ago."""
    delta = random.randint(end_days_ago, start_days_ago)
    return datetime.utcnow() - timedelta(days=delta)


def generate_mock_ad_users(count: int = 50) -> list[dict]:
    """
    Generate a list of realistic AD user dictionaries with various
    risk configurations for testing the scanner & risk engine.
    """
    users = []
    used_names = set()

    for i in range(count):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        # Ensure unique
        while f"{first}.{last}" in used_names:
            first = random.choice(FIRST_NAMES)
            last = random.choice(LAST_NAMES)
        used_names.add(f"{first}.{last}")

        sam = f"{first.lower()}.{last.lower()}"
        email = f"{sam}@example.com"
        display = f"{first} {last}"

        # ── Decide characteristics ──
        enabled = random.random() > 0.12          # ~12% disabled
        is_privileged = random.random() < 0.15     # ~15% privileged
        is_stale = random.random() < 0.18          # ~18% stale (>90 days)
        pwd_never_expires = random.random() < 0.20 # ~20% password never expires
        blank_desc = random.random() < 0.15        # ~15% blank description

        # Last logon
        if is_stale:
            last_logon = _random_date(365, 91)
        else:
            last_logon = _random_date(30, 0)

        # Password last set
        if pwd_never_expires:
            password_last_set = _random_date(500, 200)
        else:
            password_last_set = _random_date(80, 1)

        # Groups
        groups = ["Domain Users"]
        if is_privileged:
            priv_count = random.randint(1, 3)
            groups += random.sample(PRIVILEGED_GROUPS, min(priv_count, len(PRIVILEGED_GROUPS)))
        # Add some regular groups
        reg_count = random.randint(1, 4)
        groups += random.sample(REGULAR_GROUPS, min(reg_count, len(REGULAR_GROUPS)))
        groups = list(set(groups))  # deduplicate

        description = "" if blank_desc else f"{random.choice(['Senior', 'Junior', 'Lead', ''])} {random.choice(['Developer', 'Analyst', 'Manager', 'Engineer', 'Specialist', 'Consultant'])} - {random.choice(['IT', 'HR', 'Finance', 'Marketing', 'Engineering', 'Operations'])}".strip()

        # Orphaned: disabled but still in privileged groups
        is_orphaned = (not enabled) and is_privileged

        user = {
            "sam_account_name": sam,
            "display_name": display,
            "email": email,
            "enabled": enabled,
            "last_logon": last_logon.isoformat(),
            "password_last_set": password_last_set.isoformat(),
            "password_never_expires": pwd_never_expires,
            "description": description,
            "member_of": groups,
            "is_privileged": is_privileged,
            "is_stale": is_stale,
            "is_orphaned": is_orphaned,
        }
        users.append(user)

    return users
