"""
Unit Tests for RBAC System with AD Scanner
Tests for isolated helper functions and business logic.
"""

import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from auth import (
    hash_password,
    verify_password,
    validate_password_strength,
    create_access_token,
    decode_token,
    _parse_hhmm,
    _is_now_within_window,
)
from config import settings


# ─── UT-01: hash_password produces a non-plain hash ─────────────────────────
def test_UT01_hash_password_not_plain():
    """hash_password should return a bcrypt hash, not the original string."""
    plain = "MySecret@1"
    hashed = hash_password(plain)
    assert hashed != plain
    assert hashed.startswith("$2b$")


# ─── UT-02: verify_password accepts correct password ────────────────────────
def test_UT02_verify_password_correct():
    """verify_password must return True when the plain password matches the hash."""
    plain = "Correct#99"
    hashed = hash_password(plain)
    assert verify_password(plain, hashed) is True


# ─── UT-03: verify_password rejects wrong password ──────────────────────────
def test_UT03_verify_password_wrong():
    """verify_password must return False for an incorrect plain password."""
    hashed = hash_password("Correct#99")
    assert verify_password("WrongPass#1", hashed) is False


# ─── UT-04: validate_password_strength – too short ──────────────────────────
def test_UT04_password_too_short():
    """Passwords shorter than 8 characters must fail validation."""
    valid, msg = validate_password_strength("Ab1!")
    assert valid is False
    assert "8 characters" in msg


# ─── UT-05: validate_password_strength – no uppercase ───────────────────────
def test_UT05_password_no_uppercase():
    """Passwords without an uppercase letter must fail validation."""
    valid, msg = validate_password_strength("abcdefg1!")
    assert valid is False
    assert "uppercase" in msg.lower()


# ─── UT-06: validate_password_strength – strong password passes ─────────────
def test_UT06_password_strong_passes():
    """A password with upper, lower, digit, and symbol must pass validation."""
    valid, msg = validate_password_strength("Str0ng!Pass")
    assert valid is True
    assert msg == "OK"


# ─── UT-07: create_access_token returns a string ────────────────────────────
def test_UT07_create_token_returns_string():
    """create_access_token must return a non-empty JWT string."""
    token = create_access_token({"id": 1, "email": "admin@test.com", "role": "Admin"})
    assert isinstance(token, str)
    assert len(token) > 20


# ─── UT-08: decode_token recovers original payload ──────────────────────────
def test_UT08_decode_token_recovers_payload():
    """decode_token must correctly reconstruct the original payload claims."""
    payload = {"id": 42, "email": "user@test.com", "role": "Viewer"}
    token = create_access_token(payload)
    decoded = decode_token(token)
    assert decoded["id"] == 42
    assert decoded["email"] == "user@test.com"
    assert decoded["role"] == "Viewer"


# ─── UT-09: _parse_hhmm parses valid time string ────────────────────────────
def test_UT09_parse_hhmm_valid():
    """_parse_hhmm must return (hours, minutes) tuple for a valid HH:MM string."""
    result = _parse_hhmm("09:30")
    assert result == (9, 30)


# ─── UT-10: _is_now_within_window returns bool ──────────────────────────────
def test_UT10_is_within_window_returns_bool():
    """_is_now_within_window must return a boolean (True or False)."""
    result = _is_now_within_window("00:00", "23:59")
    assert isinstance(result, bool)
    # A 24-hour window must always be True
    assert result is True
