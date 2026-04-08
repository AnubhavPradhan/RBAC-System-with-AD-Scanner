"""
System / Integration Tests for RBAC System with AD Scanner
Tests use the FastAPI TestClient with an in-memory SQLite database.
"""

import pytest
import sys
import os
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db, init_db
import main as app_module

# ── Isolated in-memory test database setup ──────────────────────────────────
TEST_DB_URL = "sqlite://"  # pure in-memory SQLite (no file)
test_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    # Keep ONE connection so in-memory data persists across sessions
    poolclass=__import__("sqlalchemy.pool", fromlist=["StaticPool"]).StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

Base.metadata.create_all(bind=test_engine)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app_module.app.dependency_overrides[get_db] = override_get_db
client = TestClient(app_module.app, raise_server_exceptions=True)


# ─── Helper: register + login an admin user and return a token ──────────────
def _admin_token():
    # Signup admin
    client.post("/api/auth/signup", json={
        "name": "System Admin",
        "username": "sysadmin",
        "email": "sysadmin@rbac.test",
        "password": "Admin@12345",
        "role": "Admin",
    })
    # Force role to Admin (signup sets Viewer by default for non-seeded DBs)
    db = TestSessionLocal()
    from database import User
    u = db.query(User).filter(User.email == "sysadmin@rbac.test").first()
    if u:
        u.role = "Admin"
        db.commit()
    db.close()
    resp = client.post("/api/auth/login", json={
        "email": "sysadmin@rbac.test",
        "password": "Admin@12345",
    })
    return resp.json().get("token", "")


ADMIN_TOKEN = None


@pytest.fixture(scope="module", autouse=True)
def setup_admin():
    global ADMIN_TOKEN
    ADMIN_TOKEN = _admin_token()
    yield


def auth_header():
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


# ─── ST-01: Health check endpoint returns 200 ───────────────────────────────
def test_ST01_health_check():
    """GET /api/health must return 200 with status=OK."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "OK"


# ─── ST-02: Signup with valid data returns token ────────────────────────────
def test_ST02_signup_valid():
    """POST /api/auth/signup with valid payload must return a JWT token."""
    resp = client.post("/api/auth/signup", json={
        "name": "Jane Doe",
        "username": "janedoe",
        "email": "jane.doe@rbac.test",
        "password": "Secure@99",
        "role": "Viewer",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "token" in body
    assert body["user"]["email"] == "jane.doe@rbac.test"


# ─── ST-03: Signup with duplicate email returns 409 ─────────────────────────
def test_ST03_signup_duplicate_email():
    """POST /api/auth/signup with an existing email must return 409."""
    client.post("/api/auth/signup", json={
        "name": "Dup User",
        "username": "dupuser1",
        "email": "dup@rbac.test",
        "password": "Dup@12345",
    })
    resp = client.post("/api/auth/signup", json={
        "name": "Dup User2",
        "username": "dupuser2",
        "email": "dup@rbac.test",
        "password": "Dup@12345",
    })
    assert resp.status_code == 409


# ─── ST-04: Login with correct credentials returns token ────────────────────
def test_ST04_login_correct_credentials():
    """POST /api/auth/login with correct email+password must return a JWT token."""
    client.post("/api/auth/signup", json={
        "name": "Bob",
        "username": "bobbob",
        "email": "bob@rbac.test",
        "password": "BobPass@1",
    })
    resp = client.post("/api/auth/login", json={
        "email": "bob@rbac.test",
        "password": "BobPass@1",
    })
    assert resp.status_code == 200
    assert "token" in resp.json()


# ─── ST-05: Login with wrong password returns 401 ───────────────────────────
def test_ST05_login_wrong_password():
    """POST /api/auth/login with wrong password must return 401."""
    resp = client.post("/api/auth/login", json={
        "email": "sysadmin@rbac.test",
        "password": "WrongPass@99",
    })
    assert resp.status_code == 401


# ─── ST-06: GET /api/users requires authentication ──────────────────────────
def test_ST06_list_users_requires_auth():
    """GET /api/users without a token must return 403 or 401."""
    resp = client.get("/api/users")
    assert resp.status_code in (401, 403)


# ─── ST-07: Admin can create a new user ─────────────────────────────────────
def test_ST07_admin_create_user():
    """POST /api/users by an Admin must create the user and return 201."""
    resp = client.post("/api/users", headers=auth_header(), json={
        "name": "New User",
        "email": "newuser@rbac.test",
        "password": "NewUser@1",
        "role": "Viewer",
        "status": "Active",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "newuser@rbac.test"


# ─── ST-08: Admin can create a role ─────────────────────────────────────────
def test_ST08_admin_create_role():
    """POST /api/roles by an Admin must create the role and return 201."""
    resp = client.post("/api/roles", headers=auth_header(), json={
        "name": "TestRole",
        "description": "A role for testing",
        "permissions": [],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "TestRole"


# ─── ST-09: Admin can create a permission ───────────────────────────────────
def test_ST09_admin_create_permission():
    """POST /api/permissions by an Admin must create the permission and return 201."""
    resp = client.post("/api/permissions", headers=auth_header(), json={
        "name": "test:read",
        "description": "Read access for testing",
        "category": "Test",
        "status": "Active",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "test:read"


# ─── ST-10: GET /api/auth/me returns current user info ──────────────────────
def test_ST10_get_me_returns_current_user():
    """GET /api/auth/me with a valid token must return the authenticated user's info."""
    resp = client.get("/api/auth/me", headers=auth_header())
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "sysadmin@rbac.test"
    assert "role" in data
    assert "permissions" in data
