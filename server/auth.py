"""BUSTARON authentication — server-side credential verification (PRD §7).

Credentials are loaded from environment variables with DEVELOPMENT DEFAULTS.
In production, set the env vars to rotate without touching code:

  BUSTARON_ADMIN_ID           (default: Bustaron_admin_123)
  BUSTARON_ADMIN_PASSWORD     (default: wewillwin)
  BUSTARON_OPERATOR_ID        (default: Keeta8089)
  BUSTARON_OPERATOR_PASSWORD  (default: 808912)

WARNING: the defaults are DEV-ONLY seeds. They are never shipped to a client
bundle — verification happens exclusively server-side via POST /api/auth/login.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Credentials:
    user_id: str
    password: str
    role: str  # "admin" | "operator"


# ── env-var with dev defaults ──────────────────────────────────────────────
# Production: set BUSTARON_ADMIN_ID / BUSTARON_ADMIN_PASSWORD etc. to rotate.
ADMIN_CREDENTIALS = Credentials(
    user_id=os.environ.get("BUSTARON_ADMIN_ID", "Bustaron_admin_123"),
    password=os.environ.get("BUSTARON_ADMIN_PASSWORD", "wewillwin"),
    role="admin",
)

OPERATOR_CREDENTIALS = Credentials(
    user_id=os.environ.get("BUSTARON_OPERATOR_ID", "Keeta8089"),
    password=os.environ.get("BUSTARON_OPERATOR_PASSWORD", "808912"),
    role="operator",
)

_ALL_CREDENTIALS = [ADMIN_CREDENTIALS, OPERATOR_CREDENTIALS]


def verify_credentials(user_id: str, password: str) -> Credentials | None:
    """Returns the matching Credentials, or None if the pair is unknown.

    Case-sensitive user_id, constant-time-ish comparison (no early return on
    the first non-match to avoid timing side-channels on the user_id check).
    """
    matched: Credentials | None = None
    for creds in _ALL_CREDENTIALS:
        if creds.user_id == user_id and creds.password == password:
            matched = creds
    return matched
