"""Pytest bootstrap for the BUSTARON M3 backend (PRD S91).

Isolation is the whole point of this file. `server/main.py` derives `DATA_DIR` and
`STATE_PATH` from the `BUSTARON_DATA_DIR` environment variable **at import time**, and the
official behavioural probe (`server/probe_api.py`) owns both `:8000` and
`server/data/state.json`. If these tests imported `server.main` without redirecting the data
directory first, a pytest run and a probe run would race on the same state file and corrupt
each other's results — the exact concurrency footgun recorded in TRACE.

So the order here is load-bearing and must not be reordered:

1. point `BUSTARON_DATA_DIR` at a throwaway temp directory,
2. clear any LLM provider config so the FR-N8 deterministic path is the one exercised,
3. *only then* import `server.main`.

No server socket is opened: the API is driven in-process through FastAPI's `TestClient`,
so these tests never touch `:8000` either.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# --- step 1 & 2: environment, BEFORE the import below -------------------------------
_DATA_DIR = pathlib.Path(tempfile.mkdtemp(prefix="bustaron-pytest-"))
os.environ["BUSTARON_DATA_DIR"] = str(_DATA_DIR)

# No provider key exists in this environment. Clear the trio explicitly rather than
# relying on absence, so the suite pins the deterministic path even if a developer has
# exported a key locally for manual experiments.
for _var in ("BUSTARON_LLM_API_KEY", "BUSTARON_LLM_BASE_URL", "BUSTARON_LLM_MODEL"):
    os.environ.pop(_var, None)

# --- step 3 ------------------------------------------------------------------------
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server import main as server_main  # noqa: E402
from server.agents import DroneTrack  # noqa: E402
from tests.helpers import make_track as _make_track  # noqa: E402


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Removes the throwaway data directory so repeated runs do not litter %TEMP%."""
    shutil.rmtree(_DATA_DIR, ignore_errors=True)


@pytest.fixture()
def data_dir() -> pathlib.Path:
    """The isolated state directory this session is pinned to."""
    return _DATA_DIR


@pytest.fixture()
def client() -> TestClient:
    """A `TestClient` over a PRISTINE, freshly re-seeded state.

    NOTE — why this seeds EXPLICITLY instead of just blanking the file. Seeding happens at
    **module import** (`seed_if_empty(load_state())` at the bottom of `server/main.py`), plus
    inside the two write paths (`submit_tx`, `POST /negotiate`). A read-only endpoint such as
    `/api/health` does *not* seed. So blanking `state.json` to `{}` after import leaves the
    state genuinely empty and every seeded-table assertion fails.

    `probe_api.py` gets away with the blank-and-restart trick precisely because it RESTARTS
    the server (`kill_server()` -> `reset_state_file()` -> `start_server()`), which re-runs the
    import. In-process there is no re-import, so we rebuild the seed here instead. Same end
    state, no process churn.
    """
    server_main.STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    server_main.STATE_PATH.write_text("{}", "utf-8")
    fresh = server_main.load_state()
    server_main.seed_if_empty(fresh)
    server_main.save_state(fresh)
    with TestClient(server_main.app) as test_client:
        yield test_client


def make_track(  # re-exported so fixtures and tests share one factory
    drone_id: str,
    *,
    lat: float = 22.30,
    lng: float = 114.17,
    alt_m: float = 100.0,
    vel_n_mps: float = 0.0,
    vel_e_mps: float = 0.0,
    battery_pct: float = 80.0,
) -> DroneTrack:
    """Thin alias for `tests.helpers.make_track` (see that module for why it lives there)."""
    return _make_track(
        drone_id,
        lat=lat,
        lng=lng,
        alt_m=alt_m,
        vel_n_mps=vel_n_mps,
        vel_e_mps=vel_e_mps,
        battery_pct=battery_pct,
    )


@pytest.fixture()
def conflicting_pair() -> tuple[DroneTrack, DroneTrack]:
    """Two co-altitude drones ~56 m apart — a guaranteed FR-N2 separation conflict.

    0.0005 deg of latitude is 0.0005 * 111320 = 55.7 m, comfortably under the 150 m
    threshold, so the prediction cannot drift this out of conflict regardless of speed.
    """
    own = make_track("A", lat=22.3000, lng=114.1700, alt_m=100.0, battery_pct=80.0)
    peer = make_track("B", lat=22.3005, lng=114.1700, alt_m=100.0, battery_pct=50.0)
    return own, peer


@pytest.fixture()
def clear_pair() -> tuple[DroneTrack, DroneTrack]:
    """Two drones ~5.6 km apart in different skycells — no conflict."""
    own = make_track("A", lat=22.3000, lng=114.1700, alt_m=100.0)
    peer = make_track("B", lat=22.3500, lng=114.2000, alt_m=100.0)
    return own, peer
