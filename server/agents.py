"""LLM agent negotiation engine — PRD §8 (FR-N1..FR-N8).

Pure logic module: NO FastAPI imports, fully unit-testable in isolation. The FastAPI
wiring lives in ``server/main.py``; this module owns the negotiation semantics.

Prediction model (FR-N1)
------------------------
Each drone's track is extrapolated LINEARLY from its last known position + velocity:
``p(t) = p0 + v·t`` in a local tangent plane (north/east metres relative to the grid
anchor, HK latitude) plus altitude, sampled at 1 s steps across the 10 s prediction
window. There is no turn/acceleration model — the PRD only requires "predicts own and
peer position 10 s ahead" every second, and a constant-velocity model is the documented,
deterministic choice. Velocities are expressed in north/east m/s (``vel_n_mps`` /
``vel_e_mps``) so the prediction never depends on latitude-dependent lng scaling.

Conflict detection (FR-N2)
--------------------------
A conflict exists when, at ANY 1 s sample inside the window, the predicted 3-D
separation is < 150 m OR both drones occupy the same skycell. Separation is 3-D
(horizontal + altitude) because the FR-N5 tie-break is altitude-based, so vertical
miss distance must count. The skycell grid reuses the frontend's 600 m operating
lattice — ``SKYCELL_SIZE_M = 600`` in ``src/services/skycells.ts`` — anchored at the
same HK bounds; the PRD does not define a separate negotiation grid, so the operating
grid is reused (documented choice, keeps one grid semantics for the whole platform).

``conflict_id`` is ``"cf_"`` + the first 8 hex chars of SHA-256 over
``sorted(drone ids) + window start`` — NO timestamp, NO uuid: the same inputs always
produce the same id, and the same pair re-detecting the same collision in a later
window gets a distinct id via the window start.

Proposer selection (FR-N3)
--------------------------
The drone with the LOWER battery proposes; on a tie the LEXICOGRAPHICALLY LOWER drone
id proposes. IDs are compared as plain strings ("drone-a" < "drone-b").

Maneuver menu (FR-N3)
---------------------
``HOLD``, ``ALTITUDE_YIELD`` (±30 m), ``LATERAL_OFFSET`` (250 m), ``SLOW`` (50 %),
``REROUTE``. The tuple order IS the cost order (cheapest first) for the deterministic
policy. Simulated effects (documented simplifications — the point of the simulation is
deciding WHETHER a maneuver resolves the conflict, deterministically):

* ``HOLD``       — velocity zeroed for the whole window.
* ``SLOW``       — velocity halved for the whole window.
* ``ALTITUDE_YIELD`` — ±30 m, the sign chosen to INCREASE vertical separation from the
  peer (yield away) by ``yield_direction``; the same helper feeds the envelope's
  ``to_alt_m``, so the advertised altitude can never contradict the simulated effect.
* ``LATERAL_OFFSET`` — the whole predicted track shifted 250 m perpendicular to the
  velocity vector (left of track: (east, north) -> (-north, east)); a stationary drone
  offsets due east.
* ``REROUTE``    — modelled as a one-skycell (600 m) lateral displacement in the same
  deterministic direction, i.e. "leave the current corridor".

Negotiation rounds (FR-N3 / FR-N4)
----------------------------------
Round 1 ``PROPOSE``: one maneuver from the menu. Round 2 response: ``ACCEPT``,
``COUNTER`` (exactly ONE alternative menu maneuver) or ``REJECT`` (a non-empty reason
is required). Per-message structure is checked by ``validate_envelope``; the rules that
span both messages (same ``conflict_id``, swapped endpoints, ACCEPT echoes the proposal,
COUNTER differs from it) live in ``validate_exchange``, which is what the chain layer
in ``server/main.py`` calls before anchoring an exchange.

Deterministic policy (FR-N8 — must be TOTAL, never deadlock)
-----------------------------------------------------------
1. The proposer proposes the cheapest menu maneuver that resolves the conflict
   (simulated on the proposer's own track); if even ``REROUTE`` does not resolve,
   the proposal is ``REROUTE`` anyway and the response path falls to REJECT.
2. The peer accepts the proposal when it resolves the conflict and the peer has no
   STRICTLY cheaper resolving maneuver of its own; otherwise it counters with its own
   cheapest resolving maneuver (which by construction resolves, so the proposer's
   acceptance of a counter is implied — the resolution directly reflects the counter).
3. A ``REJECT`` (proposal that does not resolve) terminates the exchange and the
   resolution is ALWAYS the FR-N5 fixed tie-break — the fallback is unconditional.
4. FR-N5 fixed tie-break: ``Drone A`` — the lexicographically LOWER id — yields
   altitude +30 m. Non-negotiable and deterministic; battery is NOT consulted.

Every path terminates in exactly one resolution, so the policy is total.

FR-N7 vs FR-N8 (documented interpretation)
-----------------------------------------
FR-N7 budgets the whole conflict→resolution pipeline at ≤ 5 s end-to-end; FR-N8 says an
LLM attempt that exceeds 8 s counts as failed. Read naively those numbers conflict, so
the LLM seam is given a BOUNDED SLICE of the 5 s envelope: ≤ 2 s per attempt, at most
2 retries, i.e. a configured LLM can consume at most ~6 s before the mandatory fallback
— and the deterministic path (what runs when no key is configured, and after any LLM
failure) completes in single-digit milliseconds, comfortably inside FR-N7. The mission
never deadlocks on AI: ANY timeout, API error or unparseable output falls through to
the deterministic policy.

Weather evidence
----------------
Evidence accepts an OPTIONAL weather snapshot (``wind_kmh`` / ``weather_stale``). When
absent, ``weather_stale`` is reported True — this decouples the engine from the
not-yet-built HKO poller (a separate task). FR-W2's "cited wind must match the cached
HKO value" is only enforceable once that poller exists; until then the engine records
what it was given and flags staleness honestly.

Deferred
--------
``sig_drone`` is an empty string in this increment: real per-drone signatures are
M4/ESP32 work (§8.5 shows the field; nothing signs it yet). The LLM live path is
structurally present (client + wiring + retry/timeout) but cannot be verified in an
environment with no API key — the deterministic path is what the probe exercises.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("bustaron.agents")

# ------------------------------------------------------------------ constants
#: FR-N1: prediction horizon and sampling step (predict 10 s ahead, re-run every 1 s).
PREDICTION_HORIZON_S = 10
PREDICTION_STEP_S = 1

#: FR-N2: conflict threshold — predicted separation below this is a conflict.
MIN_SEPARATION_M = 150.0

#: The negotiation grid reuses the frontend's 600 m skycell lattice (src/services/skycells.ts).
SKYCELL_SIZE_M = 600.0

#: Grid anchor — identical to HK_BOUNDS in src/services/skycells.ts.
HK_BOUNDS_MIN_LAT = 22.255
HK_BOUNDS_MIN_LNG = 114.095

#: ~111.32 km per degree of latitude; longitude shrinks by cos(lat) at HK.
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LNG_AT_HK = M_PER_DEG_LAT * math.cos(math.radians(22.31))

SKYCELL_LAT_STEP = SKYCELL_SIZE_M / M_PER_DEG_LAT
SKYCELL_LNG_STEP = SKYCELL_SIZE_M / M_PER_DEG_LNG_AT_HK

#: FR-N3 maneuver menu. Tuple order IS the deterministic policy's cost order.
MANEUVER_HOLD = "HOLD"
MANEUVER_ALTITUDE_YIELD = "ALTITUDE_YIELD"
MANEUVER_LATERAL_OFFSET = "LATERAL_OFFSET"
MANEUVER_SLOW = "SLOW"
MANEUVER_REROUTE = "REROUTE"
MANEUVER_MENU: tuple[str, ...] = (
    MANEUVER_HOLD,
    MANEUVER_SLOW,
    MANEUVER_ALTITUDE_YIELD,
    MANEUVER_LATERAL_OFFSET,
    MANEUVER_REROUTE,
)

#: Menu parameter magnitudes (FR-N3).
ALTITUDE_YIELD_DELTA_M = 30.0
LATERAL_OFFSET_M = 250.0
SLOW_FACTOR = 0.5
REROUTE_OFFSET_M = SKYCELL_SIZE_M  # REROUTE = leave the current corridor (one skycell).

#: FR-N8 / LLM seam bounds (documented interpretation of FR-N7 vs FR-N8 above).
LLM_ATTEMPT_TIMEOUT_S = 2.0
LLM_MAX_RETRIES = 2

#: FR-N5 fixed tie-break altitude delta.
FR_N5_YIELD_DELTA_M = 30.0

#: Negotiation round numbers (§8.5 envelope).
ROUND_PROPOSE = 1
ROUND_RESPONSE = 2
ROUND_RESOLVE = 3

#: §8.5 envelope actions.
ACTION_PROPOSE = "PROPOSE"
ACTION_ACCEPT = "ACCEPT"
ACTION_COUNTER = "COUNTER"
ACTION_REJECT = "REJECT"
ACTION_RESOLVE = "RESOLVE"
RESPONSE_ACTIONS: tuple[str, ...] = (ACTION_ACCEPT, ACTION_COUNTER, ACTION_REJECT)

#: Reason codes recorded on responses/rejections (machine-selectable, not prose-matched).
REASON_PROPOSAL_DOES_NOT_RESOLVE = "PROPOSED_MANEUVER_DOES_NOT_RESOLVE"
REASON_FR_N5_FALLBACK = "FR_N5_FIXED_TIE_BREAK"


# --------------------------------------------------------------------- tracks
class DroneTrack(BaseModel):
    """Last-known state of one drone, in a local tangent plane friendly form.

    Position is WGS84; velocity is north/east metres per second (FR-N1's linear model
    operates in this plane so the prediction is latitude-independent).
    """

    id: str
    lat: float
    lng: float
    alt_m: float = 0.0
    vel_n_mps: float = 0.0
    vel_e_mps: float = 0.0
    battery_pct: float = Field(ge=0.0, le=100.0)


class WeatherSnapshot(BaseModel):
    """Optional weather evidence (§8.5). Absent snapshot => weather_stale=True."""

    wind_kmh: float | None = None
    weather_stale: bool = True


class Evidence(BaseModel):
    """§8.5 evidence block. ``my_pos`` / ``peer_pos`` are predicted track samples as
    ``[t_s, lat, lng, alt_m]`` rows across the prediction window."""

    my_pos: list[list[float]] = Field(default_factory=list)
    peer_pos: list[list[float]] = Field(default_factory=list)
    batt_pct: float = 0.0
    eta_s: float = 0.0
    wind_kmh: float | None = None
    weather_stale: bool = True


class NegotiationEnvelope(BaseModel):
    """§8.5 message envelope for a negotiation message (proposal or response).

    ``sig_drone`` is an empty string in this increment — real drone signatures are
    M4/ESP32 work (see module docstring, "Deferred").
    """

    model_config = ConfigDict(populate_by_name=True)

    type: Literal["negotiation"] = "negotiation"
    round: int = Field(ge=ROUND_PROPOSE, le=ROUND_RESPONSE)
    from_: str = Field(alias="from")
    to: str
    conflict_id: str
    action: Literal["PROPOSE", "ACCEPT", "COUNTER", "REJECT"]
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence: Evidence = Field(default_factory=Evidence)
    sig_drone: str = ""
    ts_ms: int = 0


class ResolutionBody(BaseModel):
    """Payload of a RESOLUTION message: which maneuver, executed by whom."""

    maneuver: str
    executor: str
    from_alt_m: float | None = None
    to_alt_m: float | None = None
    detail: str = ""


class ResolutionEnvelope(BaseModel):
    """A resolution message — the terminal, on-chain decision for a conflict."""

    model_config = ConfigDict(populate_by_name=True)

    type: Literal["resolution"] = "resolution"
    round: int = ROUND_RESOLVE
    from_: str = Field(alias="from")
    to: str
    conflict_id: str
    action: Literal["RESOLVE"]
    payload: ResolutionBody
    evidence: Evidence = Field(default_factory=Evidence)
    sig_drone: str = ""
    ts_ms: int = 0


# ------------------------------------------------------------------ prediction
def to_local_m(track: DroneTrack) -> tuple[float, float]:
    """Position in local metres (north, east) relative to the grid anchor."""
    north = (track.lat - HK_BOUNDS_MIN_LAT) * M_PER_DEG_LAT
    east = (track.lng - HK_BOUNDS_MIN_LNG) * M_PER_DEG_LNG_AT_HK
    return north, east


def to_lat_lng(north_m: float, east_m: float) -> tuple[float, float]:
    """Inverse of ``to_local_m`` — local metres back to WGS84."""
    return (
        HK_BOUNDS_MIN_LAT + north_m / M_PER_DEG_LAT,
        HK_BOUNDS_MIN_LNG + east_m / M_PER_DEG_LNG_AT_HK,
    )


def predict_positions(track: DroneTrack, window_start_s: int = 0) -> list[dict[str, float]]:
    """FR-N1: linear extrapolation samples across the 10 s window.

    Returns one row per second: ``{t_s, lat, lng, alt_m, north_m, east_m}`` where the
    metres are the local-plane position. Constant velocity — see the module docstring.
    """
    p0_n, p0_e = to_local_m(track)
    samples: list[dict[str, float]] = []
    for step in range(PREDICTION_HORIZON_S // PREDICTION_STEP_S + 1):
        t_s = window_start_s + step * PREDICTION_STEP_S
        north = p0_n + track.vel_n_mps * t_s
        east = p0_e + track.vel_e_mps * t_s
        lat, lng = to_lat_lng(north, east)
        samples.append(
            {
                "t_s": float(t_s),
                "lat": round(lat, 7),
                "lng": round(lng, 7),
                "alt_m": track.alt_m,
                "north_m": north,
                "east_m": east,
            }
        )
    return samples


def skycell_of(lat: float, lng: float) -> tuple[int, int]:
    """The 600 m skycell (row, col) containing a position — same lattice as the frontend."""
    row = math.floor((lat - HK_BOUNDS_MIN_LAT) / SKYCELL_LAT_STEP)
    col = math.floor((lng - HK_BOUNDS_MIN_LNG) / SKYCELL_LNG_STEP)
    return row, col


def conflict_id_for(drone_a: str, drone_b: str, window_start_s: int = 0) -> str:
    """Deterministic conflict id (FR-N2): SHA-256 over sorted ids + window start.

    No timestamp, no uuid — the same pair in the same window always yields the same id.
    """
    ordered = sorted((drone_a, drone_b))
    digest = hashlib.sha256(f"{ordered[0]}|{ordered[1]}|{window_start_s}".encode()).hexdigest()
    return f"cf_{digest[:8]}"


@dataclass(frozen=True)
class ConflictEvent:
    """A detected conflict (FR-N2)."""

    conflict_id: str
    drone_a: str  # lexicographically lower id
    drone_b: str
    window_start_s: int
    min_separation_m: float
    first_conflict_t_s: int
    reason: str  # "SEPARATION" | "SKYCELL" | "SEPARATION+SKYCELL"


def detect_conflict(
    own: DroneTrack,
    peer: DroneTrack,
    window_start_s: int = 0,
) -> ConflictEvent | None:
    """FR-N2: conflict iff predicted 3-D separation < 150 m OR shared skycell.

    Runs the FR-N1 linear prediction for both tracks across the window and scans every
    1 s sample. Returns None when the tracks are conflict-free.
    """
    if own.id == peer.id:
        raise ValueError("A drone cannot conflict with itself")
    own_samples = predict_positions(own, window_start_s)
    peer_samples = predict_positions(peer, window_start_s)
    min_sep = math.inf
    hit: dict[str, Any] | None = None
    for own_s, peer_s in zip(own_samples, peer_samples, strict=True):
        d_n = own_s["north_m"] - peer_s["north_m"]
        d_e = own_s["east_m"] - peer_s["east_m"]
        d_alt = own_s["alt_m"] - peer_s["alt_m"]
        sep = math.sqrt(d_n * d_n + d_e * d_e + d_alt * d_alt)
        min_sep = min(min_sep, sep)
        same_cell = skycell_of(own_s["lat"], own_s["lng"]) == skycell_of(peer_s["lat"], peer_s["lng"])
        if (sep < MIN_SEPARATION_M or same_cell) and hit is None:
            reasons = []
            if sep < MIN_SEPARATION_M:
                reasons.append("SEPARATION")
            if same_cell:
                reasons.append("SKYCELL")
            hit = {"t_s": int(own_s["t_s"]), "reason": "+".join(reasons)}
    if hit is None:
        return None
    a_id, b_id = sorted((own.id, peer.id))
    return ConflictEvent(
        conflict_id=conflict_id_for(own.id, peer.id, window_start_s),
        drone_a=a_id,
        drone_b=b_id,
        window_start_s=window_start_s,
        min_separation_m=round(min_sep, 3),
        first_conflict_t_s=hit["t_s"],
        reason=hit["reason"],
    )


# --------------------------------------------------------------------- maneuvers
def yield_direction(actor_alt_m: float, peer_alt_m: float) -> float:
    """Sign (+1 up / -1 down) of an ALTITUDE_YIELD that INCREASES 3-D separation.

    Climb when at-or-above the peer, descend when below it — climbing while BELOW the
    peer *reduces* the vertical gap, which is the opposite of the documented intent
    ("the sign chosen to INCREASE vertical separation"). FR-N5's fixed tie-break keeps
    its unconditional +30 m: that is a mandated rule, not a resolving maneuver, so it
    deliberately does NOT use this helper.
    """
    return 1.0 if actor_alt_m >= peer_alt_m else -1.0


def apply_maneuver(track: DroneTrack, maneuver: str, peer_alt_m: float | None = None) -> DroneTrack:
    """Simulated effect of a menu maneuver on a track (documented in the module docstring).

    ``ALTITUDE_YIELD`` needs the peer's altitude to pick the direction that increases
    vertical separation. Raises ValueError for a maneuver outside the menu.
    """
    if maneuver not in MANEUVER_MENU:
        raise ValueError(f"Unknown maneuver: {maneuver}")
    if maneuver == MANEUVER_HOLD:
        return track.model_copy(update={"vel_n_mps": 0.0, "vel_e_mps": 0.0})
    if maneuver == MANEUVER_SLOW:
        return track.model_copy(
            update={"vel_n_mps": track.vel_n_mps * SLOW_FACTOR, "vel_e_mps": track.vel_e_mps * SLOW_FACTOR}
        )
    if maneuver == MANEUVER_ALTITUDE_YIELD:
        if peer_alt_m is None:
            raise ValueError("ALTITUDE_YIELD needs the peer altitude to pick a direction")
        return track.model_copy(
            update={"alt_m": track.alt_m + yield_direction(track.alt_m, peer_alt_m) * ALTITUDE_YIELD_DELTA_M}
        )
    # LATERAL_OFFSET (250 m) and REROUTE (one skycell, 600 m) both shift the whole track
    # perpendicular to the velocity vector: (east, north) -> (-north, east), i.e. left of
    # track. A stationary drone offsets due east (deterministic default).
    distance = LATERAL_OFFSET_M if maneuver == MANEUVER_LATERAL_OFFSET else REROUTE_OFFSET_M
    speed = math.hypot(track.vel_e_mps, track.vel_n_mps)
    if speed == 0:
        d_e, d_n = distance, 0.0
    else:
        # Unit left-of-track perpendicular, scaled: (ve, vn) -> (-vn, ve) / speed.
        d_e = (-track.vel_n_mps / speed) * distance
        d_n = (track.vel_e_mps / speed) * distance
    d_lat = d_n / M_PER_DEG_LAT
    d_lng = d_e / M_PER_DEG_LNG_AT_HK
    return track.model_copy(update={"lat": track.lat + d_lat, "lng": track.lng + d_lng})


def maneuver_resolves_conflict(actor: DroneTrack, other: DroneTrack, maneuver: str, window_start_s: int = 0) -> bool:
    """True when the actor performing ``maneuver`` removes the conflict (simulated)."""
    moved = apply_maneuver(actor, maneuver, peer_alt_m=other.alt_m)
    return detect_conflict(moved, other, window_start_s) is None


def cheapest_resolving_maneuver(actor: DroneTrack, other: DroneTrack, window_start_s: int = 0) -> str | None:
    """The cheapest menu maneuver (cost order = MANEUVER_MENU order) that resolves."""
    for maneuver in MANEUVER_MENU:
        if maneuver_resolves_conflict(actor, other, maneuver, window_start_s):
            return maneuver
    return None


# ----------------------------------------------------------- proposer selection
def select_proposer(own: DroneTrack, peer: DroneTrack) -> tuple[DroneTrack, DroneTrack]:
    """FR-N3: lower battery proposes; tie -> lexicographically lower drone id.

    Returns (proposer, responder).
    """
    if own.battery_pct != peer.battery_pct:
        return (own, peer) if own.battery_pct < peer.battery_pct else (peer, own)
    return (own, peer) if own.id <= peer.id else (peer, own)


# ------------------------------------------------------------------ FR-N5 fallback
def fr_n5_fallback(own: DroneTrack, peer: DroneTrack) -> ResolutionBody:
    """FR-N5 fixed tie-break: Drone A (the lexicographically LOWER id) yields +30 m.

    Non-negotiable and deterministic — battery is deliberately NOT consulted.
    """
    drone_a = own if own.id <= peer.id else peer
    return ResolutionBody(
        maneuver=MANEUVER_ALTITUDE_YIELD,
        executor=drone_a.id,
        from_alt_m=drone_a.alt_m,
        to_alt_m=drone_a.alt_m + FR_N5_YIELD_DELTA_M,
        detail="FR-N5 fixed tie-break: Drone A (lower ID) yields altitude +30 m",
    )


# ---------------------------------------------------------------------- evidence
def build_evidence(
    actor: DroneTrack,
    other: DroneTrack,
    conflict: ConflictEvent,
    weather: WeatherSnapshot | None,
) -> Evidence:
    """§8.5 evidence for a message sent by ``actor``: both predicted tracks, the actor's
    battery, the ETA to the first conflict point, and the weather snapshot if any
    (absent snapshot => weather_stale=True, decoupled from the not-yet-built HKO poller)."""
    my_samples = predict_positions(actor, conflict.window_start_s)
    peer_samples = predict_positions(other, conflict.window_start_s)
    return Evidence(
        my_pos=[[s["t_s"], s["lat"], s["lng"], s["alt_m"]] for s in my_samples],
        peer_pos=[[s["t_s"], s["lat"], s["lng"], s["alt_m"]] for s in peer_samples],
        batt_pct=actor.battery_pct,
        eta_s=float(conflict.first_conflict_t_s - conflict.window_start_s),
        wind_kmh=weather.wind_kmh if weather else None,
        weather_stale=weather.weather_stale if weather else True,
    )


# ------------------------------------------------------------- envelope builders
def build_proposal(
    proposer: DroneTrack,
    responder: DroneTrack,
    conflict: ConflictEvent,
    maneuver: str,
    ts_ms: int,
    weather: WeatherSnapshot | None = None,
) -> NegotiationEnvelope:
    """Round 1 PROPOSE envelope (§8.5)."""
    if maneuver not in MANEUVER_MENU:
        raise ValueError(f"Proposal maneuver must be one of {MANEUVER_MENU}")
    return NegotiationEnvelope(
        round=ROUND_PROPOSE,
        from_=proposer.id,
        to=responder.id,
        conflict_id=conflict.conflict_id,
        action=ACTION_PROPOSE,
        payload={
            "maneuver": maneuver,
            "from_alt_m": proposer.alt_m,
            # Shared direction rule (see proposal_to_alt) so the advertised effect and
            # the simulated effect can never disagree.
            "to_alt_m": proposal_to_alt(proposer, maneuver, responder.alt_m),
        },
        evidence=build_evidence(proposer, responder, conflict, weather),
        ts_ms=ts_ms,
    )


def build_response(
    responder: DroneTrack,
    proposer: DroneTrack,
    conflict: ConflictEvent,
    action: str,
    ts_ms: int,
    maneuver: str | None = None,
    reason: str | None = None,
    weather: WeatherSnapshot | None = None,
) -> NegotiationEnvelope:
    """Round 2 ACCEPT / COUNTER(one alternative) / REJECT(reason required) envelope."""
    if action not in RESPONSE_ACTIONS:
        raise ValueError(f"Response action must be one of {RESPONSE_ACTIONS}")
    payload: dict[str, Any] = {}
    if action in (ACTION_ACCEPT, ACTION_COUNTER):
        payload["maneuver"] = maneuver
    else:
        payload["reason"] = reason
    return NegotiationEnvelope(
        round=ROUND_RESPONSE,
        from_=responder.id,
        to=proposer.id,
        conflict_id=conflict.conflict_id,
        action=action,
        payload=payload,
        evidence=build_evidence(responder, proposer, conflict, weather),
        ts_ms=ts_ms,
    )


def build_resolution(
    body: ResolutionBody,
    own: DroneTrack,
    peer: DroneTrack,
    conflict: ConflictEvent,
    ts_ms: int,
    weather: WeatherSnapshot | None = None,
) -> ResolutionEnvelope:
    """Terminal RESOLUTION envelope; ``body.executor`` names the executing drone.

    A body naming a drone that is not one of the two parties is a caller error: the old
    fallback silently attributed it to the peer, producing a resolution that LOOKED
    well-formed while naming nobody. Raise instead of guessing.
    """
    if body.executor == own.id:
        executor, other = own, peer
    elif body.executor == peer.id:
        executor, other = peer, own
    else:
        raise ValueError(f"Resolution executor {body.executor!r} is neither {own.id!r} nor {peer.id!r}")
    return ResolutionEnvelope(
        round=ROUND_RESOLVE,
        from_=executor.id,
        to=other.id,
        conflict_id=conflict.conflict_id,
        action=ACTION_RESOLVE,
        payload=body,
        evidence=build_evidence(executor, other, conflict, weather),
        ts_ms=ts_ms,
    )


# ------------------------------------------------------------------ validation
def validate_envelope(envelope: NegotiationEnvelope) -> list[str]:
    """Structural validation of ONE negotiation message (FR-N3 / FR-N4).

    Returns a list of problems (empty = valid); the chain layer turns these into 4xx.
    Rules that span both messages of an exchange live in ``validate_exchange`` — a single
    message cannot know what it is responding to.
    """
    problems: list[str] = []
    if envelope.action == ACTION_PROPOSE:
        if envelope.round != ROUND_PROPOSE:
            problems.append("PROPOSE must be round 1")
        maneuver = envelope.payload.get("maneuver")
        if maneuver not in MANEUVER_MENU:
            problems.append(f"proposal maneuver must be one of {MANEUVER_MENU}")
    elif envelope.action == ACTION_ACCEPT:
        if envelope.round != ROUND_RESPONSE:
            problems.append("ACCEPT must be round 2")
        if envelope.payload.get("maneuver") not in MANEUVER_MENU:
            problems.append("ACCEPT must echo a menu maneuver")
    elif envelope.action == ACTION_COUNTER:
        if envelope.round != ROUND_RESPONSE:
            problems.append("COUNTER must be round 2")
        if envelope.payload.get("maneuver") not in MANEUVER_MENU:
            problems.append(f"COUNTER maneuver must be one of {MANEUVER_MENU}")
    else:  # REJECT
        if envelope.round != ROUND_RESPONSE:
            problems.append("REJECT must be round 2")
        if not str(envelope.payload.get("reason", "")).strip():
            problems.append("REJECT requires a non-empty reason")
    return problems


def validate_exchange(proposal: NegotiationEnvelope, response: NegotiationEnvelope) -> list[str]:
    """Cross-message validation of one exchange (FR-N3 / FR-N4).

    A single-message check cannot enforce FR-N4's "COUNTER must offer an ALTERNATIVE" or
    FR-N3's "ACCEPT the proposal": both need the proposal in hand. The old single-message
    check compared the counter against a ``payload["proposed"]`` key that NO builder ever
    sets, so it was dead code and an identical counter validated clean. This is the
    function the chain layer calls before anchoring.
    """
    problems: list[str] = validate_envelope(proposal) + validate_envelope(response)
    if proposal.action != ACTION_PROPOSE:
        problems.append("an exchange must open with a PROPOSE")
    if proposal.conflict_id != response.conflict_id:
        problems.append("response conflict_id does not match the proposal")
    if response.from_ != proposal.to or response.to != proposal.from_:
        problems.append("response endpoints must swap the proposal's from/to")
    proposed_maneuver = proposal.payload.get("maneuver")
    if response.action == ACTION_ACCEPT and response.payload.get("maneuver") != proposed_maneuver:
        problems.append("ACCEPT must echo the proposed maneuver")
    if response.action == ACTION_COUNTER and response.payload.get("maneuver") == proposed_maneuver:
        problems.append("COUNTER must offer an ALTERNATIVE to the proposal")
    return problems


# ------------------------------------------------------------- deterministic engine
@dataclass(frozen=True)
class NegotiationOutcome:
    """The full deterministic exchange for one conflict: proposal, response, resolution."""

    conflict: ConflictEvent
    proposal: NegotiationEnvelope
    response: NegotiationEnvelope
    resolution: ResolutionEnvelope
    fallback: bool  # True when the FR-N5 fixed tie-break produced the resolution


class DeterministicNegotiator:
    """FR-N8's total policy — always terminates with exactly one resolution.

    Policy (module docstring, "Deterministic policy"): proposer offers the cheapest
    resolving maneuver; the peer accepts unless it has a strictly cheaper resolving
    maneuver (then it counters); a non-resolving proposal is rejected and the
    resolution is ALWAYS the FR-N5 fixed tie-break.
    """

    def name(self) -> str:
        return "deterministic"

    def negotiate(
        self,
        own: DroneTrack,
        peer: DroneTrack,
        window_start_s: int = 0,
        ts_ms: int = 0,
        weather: WeatherSnapshot | None = None,
    ) -> NegotiationOutcome | None:
        conflict = detect_conflict(own, peer, window_start_s)
        if conflict is None:
            return None
        proposer, responder = select_proposer(own, peer)
        maneuver = cheapest_resolving_maneuver(proposer, responder, window_start_s) or MANEUVER_REROUTE
        proposal = build_proposal(proposer, responder, conflict, maneuver, ts_ms, weather)

        resolution_body: ResolutionBody
        fallback = False
        if maneuver_resolves_conflict(proposer, responder, maneuver, window_start_s):
            peer_cheapest = cheapest_resolving_maneuver(responder, proposer, window_start_s)
            if peer_cheapest is not None and MANEUVER_MENU.index(peer_cheapest) < MANEUVER_MENU.index(maneuver):
                # Peer can do strictly better itself -> COUNTER; the counter resolves by
                # construction, so the resolution directly reflects the countered maneuver.
                response = build_response(
                    responder, proposer, conflict, ACTION_COUNTER, ts_ms, maneuver=peer_cheapest, weather=weather
                )
                resolution_body = ResolutionBody(
                    maneuver=peer_cheapest,
                    executor=responder.id,
                    from_alt_m=responder.alt_m,
                    to_alt_m=proposal_to_alt(responder, peer_cheapest, proposer.alt_m),
                    detail="COUNTER accepted: resolution reflects the countered maneuver",
                )
            else:
                response = build_response(
                    responder, proposer, conflict, ACTION_ACCEPT, ts_ms, maneuver=maneuver, weather=weather
                )
                to_alt = proposal.payload.get("to_alt_m", proposer.alt_m)
                resolution_body = ResolutionBody(
                    maneuver=maneuver,
                    executor=proposer.id,
                    from_alt_m=proposer.alt_m,
                    to_alt_m=to_alt,
                    detail="ACCEPT: resolution executes the proposed maneuver",
                )
        else:
            # Even REROUTE did not resolve the simulated conflict: REJECT and fall back.
            response = build_response(
                responder,
                proposer,
                conflict,
                ACTION_REJECT,
                ts_ms,
                reason=REASON_PROPOSAL_DOES_NOT_RESOLVE,
                weather=weather,
            )
            resolution_body = fr_n5_fallback(own, peer)
            fallback = True
        resolution = build_resolution(resolution_body, own, peer, conflict, ts_ms, weather)
        return NegotiationOutcome(
            conflict=conflict,
            proposal=proposal,
            response=response,
            resolution=resolution,
            fallback=fallback,
        )


# ------------------------------------------------------------------ LLM seam (8.1)
class LLMConfig(BaseModel):
    """OpenAI-compatible client configuration, read from the environment (all optional).

    * ``BUSTARON_LLM_API_KEY`` — bearer key; absent => the deterministic negotiator runs
      (FR-N8 requires the deterministic path to always work).
    * ``BUSTARON_LLM_BASE_URL`` — e.g. ``https://open.bigmodel.cn/api/paas/v4`` (Zhipu
      GLM-4-Flash default), ``.../v1`` for OpenAI-compatible providers generally.
    * ``BUSTARON_LLM_MODEL`` — defaults to ``glm-4-flash`` (free); Qwen / DeepSeek are
      provider-agnostic drop-ins via base_url + model.
    """

    api_key: str | None = None
    base_url: str | None = None
    model: str = "glm-4-flash"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def llm_config_from_env() -> LLMConfig:
    """Builds the client config from ``BUSTARON_LLM_*`` env vars (all optional)."""
    return LLMConfig(
        api_key=os.environ.get("BUSTARON_LLM_API_KEY") or None,
        base_url=os.environ.get("BUSTARON_LLM_BASE_URL") or None,
        model=os.environ.get("BUSTARON_LLM_MODEL") or "glm-4-flash",
    )


class LLMDecision(BaseModel):
    """The parsed JSON decision an LLM is asked to return."""

    action: Literal["ACCEPT", "COUNTER", "REJECT"]
    maneuver: str | None = None
    reason: str | None = None


def validate_llm_decision(decision: LLMDecision, proposal_maneuver: str) -> list[str]:
    """Turns an LLM decision into validation problems (empty = usable)."""
    if decision.action == "COUNTER":
        if decision.maneuver not in MANEUVER_MENU:
            return [f"COUNTER maneuver must be one of {MANEUVER_MENU}"]
        if decision.maneuver == proposal_maneuver:
            return ["COUNTER must offer an alternative to the proposal"]
        return []
    if decision.action == "ACCEPT":
        return [] if decision.maneuver in (None, proposal_maneuver) else ["ACCEPT must echo the proposed maneuver"]
    if not (decision.reason or "").strip():
        return ["REJECT requires a reason"]
    return []


class LLMNegotiator:
    """Provider-agnostic LLM negotiator (PRD 8.1) with the deterministic fallback (FR-N8).

    When no API key is configured this is a thin pass-through to the deterministic
    negotiator. When configured, each chat attempt is bounded to ≤ 2 s with at most 2
    retries; ANY timeout, API error or unparseable/invalid output falls through to the
    deterministic policy, so the mission never deadlocks on AI. The deterministic path
    is what FR-N7's 5 s budget is spent on in this environment (single-digit ms).
    """

    def __init__(
        self,
        config: LLMConfig | None = None,
        deterministic: DeterministicNegotiator | None = None,
        timeout_s: float = LLM_ATTEMPT_TIMEOUT_S,
        retries: int = LLM_MAX_RETRIES,
    ) -> None:
        self.config = config if config is not None else llm_config_from_env()
        self.deterministic = deterministic if deterministic is not None else DeterministicNegotiator()
        self.timeout_s = timeout_s
        self.retries = retries

    def name(self) -> str:
        return "llm" if self.config.configured else "deterministic"

    def negotiate(
        self,
        own: DroneTrack,
        peer: DroneTrack,
        window_start_s: int = 0,
        ts_ms: int = 0,
        weather: WeatherSnapshot | None = None,
    ) -> NegotiationOutcome | None:
        if not self.config.configured:
            return self.deterministic.negotiate(own, peer, window_start_s, ts_ms, weather)
        conflict = detect_conflict(own, peer, window_start_s)
        if conflict is None:
            return None
        proposer, responder = select_proposer(own, peer)
        maneuver = cheapest_resolving_maneuver(proposer, responder, window_start_s) or MANEUVER_REROUTE
        decision = self._decide_with_retries(proposer, responder, conflict, maneuver, weather)
        if decision is None:
            # FR-N8: timeout / API error / unparseable output -> deterministic policy.
            logger.warning("LLM negotiation unavailable — falling back to the deterministic policy (FR-N8)")
            return self.deterministic.negotiate(own, peer, window_start_s, ts_ms, weather)
        used_fallback = False
        if decision.action == "ACCEPT":
            response = build_response(
                responder, proposer, conflict, ACTION_ACCEPT, ts_ms, maneuver=maneuver, weather=weather
            )
            body = ResolutionBody(
                maneuver=maneuver,
                executor=proposer.id,
                from_alt_m=proposer.alt_m,
                to_alt_m=proposal_to_alt(proposer, maneuver, responder.alt_m),
                detail="LLM ACCEPT",
            )
        elif decision.action == "COUNTER" and decision.maneuver is not None:
            response = build_response(
                responder, proposer, conflict, ACTION_COUNTER, ts_ms,
                maneuver=decision.maneuver, weather=weather,
            )
            body = ResolutionBody(
                maneuver=decision.maneuver,
                executor=responder.id,
                from_alt_m=responder.alt_m,
                to_alt_m=proposal_to_alt(responder, decision.maneuver, proposer.alt_m),
                detail="LLM COUNTER",
            )
        else:
            response = build_response(
                responder, proposer, conflict, ACTION_REJECT, ts_ms,
                reason=decision.reason or "LLM rejected the proposal", weather=weather,
            )
            body = fr_n5_fallback(own, peer)
            used_fallback = True
        proposal = build_proposal(proposer, responder, conflict, maneuver, ts_ms, weather)
        # The LLM may only speak through a VALID exchange: an ACCEPT that does not echo
        # the proposal, or a COUNTER identical to it, is an unusable output (FR-N8), not an
        # agreement the peers never made. Fall back rather than anchor it.
        problems = validate_exchange(proposal, response)
        if problems:
            logger.warning(
                "LLM exchange invalid (%s) — falling back to the deterministic policy (FR-N8)",
                "; ".join(problems),
            )
            return self.deterministic.negotiate(own, peer, window_start_s, ts_ms, weather)
        resolution = build_resolution(body, own, peer, conflict, ts_ms, weather)
        return NegotiationOutcome(conflict, proposal, response, resolution, fallback=used_fallback)

    def _decide_with_retries(
        self,
        proposer: DroneTrack,
        responder: DroneTrack,
        conflict: ConflictEvent,
        maneuver: str,
        weather: WeatherSnapshot | None,
    ) -> LLMDecision | None:
        for attempt in range(self.retries + 1):
            raw = self._call_chat(proposer, responder, conflict, maneuver, weather)
            if raw is None:
                continue
            try:
                decision = LLMDecision(**json.loads(raw))
            except (json.JSONDecodeError, ValueError):
                logger.warning("LLM output unparseable (attempt %s) — %r", attempt + 1, raw[:120])
                continue
            problems = validate_llm_decision(decision, maneuver)
            if problems:
                logger.warning("LLM decision invalid (attempt %s): %s", attempt + 1, "; ".join(problems))
                continue
            return decision
        return None

    def _call_chat(
        self,
        proposer: DroneTrack,
        responder: DroneTrack,
        conflict: ConflictEvent,
        maneuver: str,
        weather: WeatherSnapshot | None,
    ) -> str | None:
        """One bounded OpenAI-compatible chat call. None on ANY failure (never raises)."""
        if not self.config.configured or not self.config.base_url:
            return None
        url = self.config.base_url.rstrip("/") + "/chat/completions"
        prompt = _llm_prompt(proposer, responder, conflict, maneuver, weather)
        body = json.dumps(
            {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": "You are a drone deconfliction negotiator. Answer with JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.config.api_key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return payload["choices"][0]["message"]["content"]
        except (urllib.error.URLError, TimeoutError, OSError, KeyError, IndexError, json.JSONDecodeError) as exc:
            logger.warning("LLM attempt failed (%s) — %s", type(exc).__name__, exc)
            return None


def proposal_to_alt(track: DroneTrack, maneuver: str, peer_alt_m: float) -> float:
    """The altitude after a maneuver, using the SAME direction rule as the simulation.

    Only ALTITUDE_YIELD changes altitude. Sharing ``yield_direction`` is what keeps the
    §8.5 envelope honest: the old copy always advertised ``+30`` while ``apply_maneuver``
    moved the drone by ±30 depending on the peer, so a drone BELOW its peer was told it
    would climb — into the peer — with the two halves disagreeing.
    """
    if maneuver != MANEUVER_ALTITUDE_YIELD:
        return track.alt_m
    return track.alt_m + yield_direction(track.alt_m, peer_alt_m) * ALTITUDE_YIELD_DELTA_M


def _llm_prompt(
    proposer: DroneTrack,
    responder: DroneTrack,
    conflict: ConflictEvent,
    maneuver: str,
    weather: WeatherSnapshot | None,
) -> str:
    menu = ", ".join(MANEUVER_MENU)
    wind = weather.wind_kmh if weather else None
    stale = weather.weather_stale if weather else True
    return (
        f"Conflict {conflict.conflict_id}: drones {proposer.id} (battery {proposer.battery_pct}%) and "
        f"{responder.id} (battery {responder.battery_pct}%) predict {conflict.reason} at t="
        f"{conflict.first_conflict_t_s}s, min separation {conflict.min_separation_m}m.\n"
        f"{proposer.id} proposes {maneuver}. Wind: {wind} km/h (stale={stale}).\n"
        f"Respond with JSON only: {{\"action\": \"ACCEPT\"|\"COUNTER\"|\"REJECT\", "
        f"\"maneuver\": <one of {menu} for COUNTER>, \"reason\": <required for REJECT>}}"
    )
