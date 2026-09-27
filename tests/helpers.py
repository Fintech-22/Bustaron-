"""Shared test helpers.

Deliberately a plain module with **no import-time side effects**: `conftest.py` sets
`BUSTARON_DATA_DIR` before importing `server.main`, and re-executing that file (which would
happen if a test imported `tests.conftest` directly) would point the env var at a second
temp directory while `server.main.STATE_PATH` still referenced the first. Keeping the
factory here means the bootstrap runs exactly once.
"""

from __future__ import annotations

from server.agents import DroneTrack


def make_track(
    drone_id: str,
    *,
    lat: float = 22.30,
    lng: float = 114.17,
    alt_m: float = 100.0,
    vel_n_mps: float = 0.0,
    vel_e_mps: float = 0.0,
    battery_pct: float = 80.0,
) -> DroneTrack:
    """Builds a `DroneTrack` with the fields a test does not care about defaulted."""
    return DroneTrack(
        id=drone_id,
        lat=lat,
        lng=lng,
        alt_m=alt_m,
        vel_n_mps=vel_n_mps,
        vel_e_mps=vel_e_mps,
        battery_pct=battery_pct,
    )


def track_payload(
    drone_id: str,
    *,
    lat: float = 22.30,
    lng: float = 114.17,
    alt_m: float = 100.0,
    vel_n_mps: float = 0.0,
    vel_e_mps: float = 0.0,
    battery_pct: float = 80.0,
) -> dict[str, float | str]:
    """The same track as a JSON body, for driving `POST /negotiate` over HTTP."""
    return {
        "id": drone_id,
        "lat": lat,
        "lng": lng,
        "alt_m": alt_m,
        "vel_n_mps": vel_n_mps,
        "vel_e_mps": vel_e_mps,
        "battery_pct": battery_pct,
    }
