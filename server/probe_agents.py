"""Behavioral probe for the PRD §8 negotiation engine — `server/agents.py`.

Run: python server/probe_agents.py

Pure logic, no HTTP: it imports the engine directly and asserts the PRD's
falsifiable claims (FR-N1..FR-N8, §8.5). Several cases are built to be
DISCRIMINATING — they fail against the pre-review engine, which is the only way a
green run means anything:

* the ALTITUDE_YIELD direction case fails unless the yield moves AWAY from the peer
  (the old rule climbed when below the peer, reducing separation);
* the `to_alt_m` invariant fails unless the envelope's advertised altitude equals
  `apply_maneuver`'s simulated result for every menu maneuver;
* the counter-identity case fails unless the cross-message validator exists at all
  (the old single-message check compared against a payload key nothing ever set).

The LLM leg is exercised by replacing `urllib.request.urlopen` with a stub, so no
network and no API key are required, and the endpoint-killed case uses a closed
port (S21).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any


def _add_repo_root_to_path() -> None:
    """Puts the repo root on sys.path so `server.agents` is importable as a package."""
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor / "server" / "agents.py").is_file():
            if str(ancestor) not in sys.path:
                sys.path.insert(0, str(ancestor))
            return


_add_repo_root_to_path()

from server import agents as engine  # noqa: E402  (needs the sys.path bootstrap above)

failures = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global failures
    if condition:
        print(f"PASS  {label}")
    else:
        failures += 1
        print(f"FAIL  {label}{' — ' + detail if detail else ''}")


# --------------------------------------------------------------------- helpers
def cell_center(row: int, col: int) -> tuple[float, float]:
    """WGS84 centre of skycell (row, col) — used to build precondition-exact cases."""
    lat = engine.HK_BOUNDS_MIN_LAT + (row + 0.5) * engine.SKYCELL_LAT_STEP
    lng = engine.HK_BOUNDS_MIN_LNG + (col + 0.5) * engine.SKYCELL_LNG_STEP
    return lat, lng


def m_offset_lat(lat: float, metres: float) -> float:
    return lat + metres / engine.M_PER_DEG_LAT


def track(drone_id: str, lat: float, lng: float, alt_m: float = 100.0, vn: float = 0.0,
          ve: float = 0.0, battery: float = 80.0) -> engine.DroneTrack:
    return engine.DroneTrack(
        id=drone_id, lat=lat, lng=lng, alt_m=alt_m, vel_n_mps=vn, vel_e_mps=ve, battery_pct=battery
    )


def base_pair() -> tuple[engine.DroneTrack, engine.DroneTrack]:
    """Two stationary drones 2 m apart horizontally, straddling a skycell boundary.

    A 2 m horizontal gap is far inside any cell, so the pair can only sit in DIFFERENT
    cells if it straddles a boundary. `different_cells_pair` asserts that precondition.
    """
    lat, lng = cell_center(10, 20)
    boundary_lat = engine.HK_BOUNDS_MIN_LAT + 11 * engine.SKYCELL_LAT_STEP  # row 10/11 line
    # 1 m on each side of the boundary line: same column, different rows.
    return (
        track("drone-a", m_offset_lat(boundary_lat, -1.0), lng, alt_m=100.0),
        track("drone-b", m_offset_lat(boundary_lat, 1.0), lng, alt_m=230.0),
    )


print("== §8.2 FR-N1 prediction ==")
t = track("drone-a", 22.30, 114.15, alt_m=90.0, vn=10.0)
samples = engine.predict_positions(t)
check("FR-N1: 11 samples across the 10 s window (1 Hz)", [s["t_s"] for s in samples] == [float(i) for i in range(11)])
check(
    "FR-N1: linear extrapolation reaches the expected north displacement after 10 s",
    abs(samples[10]["north_m"] - engine.to_local_m(t)[0] - 100.0) < 1e-6,
    f"north_m={samples[10]['north_m']}",
)
lat_back, lng_back = engine.to_lat_lng(*engine.to_local_m(t))
check("FR-N1: local-plane projection round-trips WGS84", abs(lat_back - t.lat) < 1e-9 and abs(lng_back - t.lng) < 1e-9)

print("== §8.2 FR-N2 conflict detection ==")
far_a = track("drone-a", *cell_center(10, 20))
far_b = track("drone-b", *cell_center(16, 26))  # ~3.5 km away: different cell, sep >> 150
check("FR-N2: distant tracks are conflict-free", engine.detect_conflict(far_a, far_b) is None)

near_lat, near_lng = cell_center(10, 20)
# 90 m apart inside one cell: BOTH legs fire (too close AND same cell).
both_legs_pair = (track("drone-a", near_lat, near_lng), track("drone-b", m_offset_lat(near_lat, 90.0), near_lng))
both_legs = engine.detect_conflict(*both_legs_pair)
check(
    "FR-N2: 90 m inside one skycell reports BOTH legs, with an exact separation",
    both_legs is not None and both_legs.reason == "SEPARATION+SKYCELL"
    and abs(both_legs.min_separation_m - 90.0) < 1e-6,
    f"reason={getattr(both_legs, 'reason', None)} min_sep={getattr(both_legs, 'min_separation_m', None)}",
)

# 200 m apart in the SAME cell: separation is fine, the skycell rule alone fires.
same_cell_pair = (track("drone-a", near_lat, near_lng), track("drone-b", m_offset_lat(near_lat, 200.0), near_lng))
same_cell = engine.detect_conflict(*same_cell_pair)
check(
    "precondition: the 200 m pair really is inside one 600 m skycell",
    engine.skycell_of(same_cell_pair[0].lat, same_cell_pair[0].lng)
    == engine.skycell_of(same_cell_pair[1].lat, same_cell_pair[1].lng),
)
check(
    "FR-N2: the SKYCELL leg alone fires above the 150 m separation threshold",
    same_cell is not None and same_cell.reason == "SKYCELL" and same_cell.min_separation_m > engine.MIN_SEPARATION_M,
    f"reason={getattr(same_cell, 'reason', None)} min_sep={getattr(same_cell, 'min_separation_m', None)}",
)

crossing = (
    track("drone-a", near_lat, near_lng, vn=50.0, battery=60.0),
    track("drone-b", m_offset_lat(near_lat, 900.0), near_lng, vn=-50.0, battery=60.0),
)
cross_conflict = engine.detect_conflict(*crossing)
check(
    "FR-N2: a predicted crossing inside the window is detected ahead of time",
    cross_conflict is not None and cross_conflict.first_conflict_t_s > 0,
    f"t={getattr(cross_conflict, 'first_conflict_t_s', None)}",
)
id_a = engine.conflict_id_for("drone-a", "drone-b", 0)
id_b = engine.conflict_id_for("drone-b", "drone-a", 0)
check(
    "FR-N2: conflict_id is order-independent and deterministic",
    id_a == id_b and engine.conflict_id_for("drone-a", "drone-b", 0) == id_a,
)
check("FR-N2: a later window gets a distinct conflict_id", engine.conflict_id_for("drone-a", "drone-b", 5) != id_a)
raised = False
try:
    engine.detect_conflict(far_a, far_a)
except ValueError:
    raised = True
check("FR-N2: self-conflict is rejected, not silently reported", raised)

print("== §8.3 FR-N3 proposer selection ==")
low_batt = (track("drone-a", *cell_center(10, 20), battery=40.0), track("drone-b", *cell_center(10, 20), battery=90.0))
proposer, responder = engine.select_proposer(*low_batt)
check("FR-N3: the lower-battery drone proposes", proposer.id == "drone-a" and responder.id == "drone-b")
tie = (track("drone-b", *cell_center(10, 20), battery=80.0), track("drone-a", *cell_center(10, 20), battery=80.0))
proposer, responder = engine.select_proposer(*tie)
check("FR-N3: a battery tie is broken by the lower drone id", proposer.id == "drone-a" and responder.id == "drone-b")

print("== §8.3 FR-N3 maneuver menu ==")
check("FR-N3: the menu is exactly HOLD/ALTITUDE_YIELD/LATERAL_OFFSET/SLOW/REROUTE",
      set(engine.MANEUVER_MENU) == {"HOLD", "ALTITUDE_YIELD", "LATERAL_OFFSET", "SLOW", "REROUTE"})

# The actor flies north at 120 m/s toward a stationary peer in the NEXT skycell
# (row 10 centre -> row 11 centre = 600 m). It enters the peer's cell at t=2.5 s.
# Stopping at once (HOLD) therefore resolves; SLOW only halves the speed, so the actor
# still reaches the boundary inside the window and stays in the peer's cell.
hold_case = (
    track("drone-a", *cell_center(10, 20), alt_m=100.0, vn=120.0),
    track("drone-b", *cell_center(11, 20), alt_m=100.0),
)
check(
    "precondition: the HOLD case is conflict-free only before the actor moves",
    engine.cheapest_resolving_maneuver(hold_case[0], hold_case[1]) is not None,
)
check(
    "FR-N3: HOLD is chosen when stopping alone resolves the conflict",
    engine.cheapest_resolving_maneuver(hold_case[0], hold_case[1]) == engine.MANEUVER_HOLD,
    f"chosen={engine.cheapest_resolving_maneuver(hold_case[0], hold_case[1])}",
)
check(
    "FR-N3: SLOW alone does NOT resolve that same conflict (HOLD was not a free choice)",
    not engine.maneuver_resolves_conflict(hold_case[0], hold_case[1], engine.MANEUVER_SLOW),
)

colocated = (track("drone-a", near_lat, near_lng), track("drone-b", near_lat, near_lng))
check(
    "precondition: the co-located pair sits in one skycell",
    engine.skycell_of(colocated[0].lat, colocated[0].lng)
    == engine.skycell_of(colocated[1].lat, colocated[1].lng),
)
check(
    "FR-N3: a co-located pair is only cleared by REROUTE (leaving the skycell)",
    engine.cheapest_resolving_maneuver(colocated[0], colocated[1]) == engine.MANEUVER_REROUTE,
    f"chosen={engine.cheapest_resolving_maneuver(colocated[0], colocated[1])}",
)

print("== §8.3 FR-N2/N3 skycell semantics + the yield-direction fix ==")
actor, peer = base_pair()
check("precondition: the pair straddles a skycell boundary (different cells)",
      engine.skycell_of(actor.lat, actor.lng) != engine.skycell_of(peer.lat, peer.lng))
pre = engine.detect_conflict(actor, peer)
check("precondition: vertical gap 130 m alone fires the conflict",
      pre is not None and pre.reason == "SEPARATION" and abs(pre.min_separation_m - 130.0) < 1.0,
      f"reason={getattr(pre, 'reason', None)} min_sep={getattr(pre, 'min_separation_m', None)}")
check("FR-N3: yield direction ADDS to the vertical gap when the actor is below the peer",
      engine.yield_direction(100.0, 230.0) == -1.0 and engine.yield_direction(230.0, 100.0) == 1.0
      and engine.yield_direction(100.0, 100.0) == 1.0)
yielded = engine.apply_maneuver(actor, engine.MANEUVER_ALTITUDE_YIELD, peer_alt_m=peer.alt_m)
check("FR-N3: ALTITUDE_YIELD moves the actor AWAY (down) from a higher peer",
      abs(yielded.alt_m - (actor.alt_m - engine.ALTITUDE_YIELD_DELTA_M)) < 1e-9, f"alt={yielded.alt_m}")
check("FR-N3: the yielded track is then conflict-free",
      engine.detect_conflict(yielded, peer) is None)
check("FR-N3: ALTITUDE_YIELD is the cheapest resolving maneuver in this case",
      engine.cheapest_resolving_maneuver(actor, peer) == engine.MANEUVER_ALTITUDE_YIELD,
      f"chosen={engine.cheapest_resolving_maneuver(actor, peer)}")

outcome = engine.DeterministicNegotiator().negotiate(actor, peer, ts_ms=1_726_920_031_120)
check(
    "FR-N3: the engine proposes the resolved maneuver",
    outcome is not None and outcome.proposal.payload["maneuver"] == engine.MANEUVER_ALTITUDE_YIELD,
)
for maneuver in engine.MANEUVER_MENU:
    simulated = engine.apply_maneuver(actor, maneuver, peer_alt_m=peer.alt_m)
    advertised = engine.proposal_to_alt(actor, maneuver, peer.alt_m)
    check(f"§8.5 advertises the true effect of {maneuver}", abs(advertised - simulated.alt_m) < 1e-9,
          f"advertised={advertised} simulated={simulated.alt_m}")
simulated_alt = engine.apply_maneuver(actor, engine.MANEUVER_ALTITUDE_YIELD, peer_alt_m=peer.alt_m).alt_m
check(
    "§8.5: the proposal's to_alt_m equals the simulated result (the fixed invariant)",
    outcome is not None and abs(outcome.proposal.payload["to_alt_m"] - simulated_alt) < 1e-9,
    f"to_alt_m={outcome.proposal.payload['to_alt_m'] if outcome else None} simulated={simulated_alt}",
)

print("== §8.3 FR-N4 responses + §8.5 envelope ==")
check("FR-N4: the response is one of ACCEPT/COUNTER/REJECT",
      outcome is not None and outcome.response.action in engine.RESPONSE_ACTIONS,
      f"action={getattr(outcome.response, 'action', None) if outcome else None}")
check(
    "FR-N4: the engine's own exchange validates as a pair",
    outcome is not None and engine.validate_exchange(outcome.proposal, outcome.response) == [],
)
check("§8.5: the terminal message is a RESOLVE resolution naming the executor",
      outcome is not None and outcome.resolution.action == engine.ACTION_RESOLVE
      and outcome.resolution.payload.executor in {actor.id, peer.id})
dumped = outcome.resolution.model_dump(by_alias=True)
ENVELOPE_KEYS = {"type", "round", "from", "to", "conflict_id", "action", "payload", "evidence", "sig_drone", "ts_ms"}
check(
    "§8.5: serialises with the `from`/`to` aliases and the negotiation envelope keys",
    set(dumped) >= ENVELOPE_KEYS and "from_" not in dumped,
)
check("§8.5: sig_drone is present but empty (documented M4/ESP32 deferral)", dumped["sig_drone"] == "")
check(
    "§8.5: absent weather is reported honestly as stale",
    dumped["evidence"]["weather_stale"] is True and dumped["evidence"]["wind_kmh"] is None,
)

snapshot = engine.WeatherSnapshot(wind_kmh=28.0, weather_stale=False)
with_weather = engine.DeterministicNegotiator().negotiate(actor, peer, ts_ms=0, weather=snapshot)
check("§8.5: a supplied snapshot is carried verbatim (wind 28, not stale)",
      with_weather is not None and with_weather.resolution.evidence.wind_kmh == 28.0
      and with_weather.resolution.evidence.weather_stale is False)

print("== §8.3/FR-N4 cross-message validation ==")
bad_conflict = engine.build_response(peer, actor, pre, engine.ACTION_ACCEPT, 0, maneuver=engine.MANEUVER_ALTITUDE_YIELD)
bad_conflict.conflict_id = "cf_deadbeef"
check("FR-N4: a response answering a different conflict_id is rejected",
      "response conflict_id does not match the proposal" in engine.validate_exchange(outcome.proposal, bad_conflict))

not_swapped = engine.build_response(peer, peer, pre, engine.ACTION_ACCEPT, 0, maneuver=engine.MANEUVER_ALTITUDE_YIELD)
check("FR-N4: a response whose endpoints are not swapped is rejected",
      "response endpoints must swap the proposal's from/to" in engine.validate_exchange(outcome.proposal, not_swapped))

silent_accept = engine.build_response(peer, actor, pre, engine.ACTION_ACCEPT, 0, maneuver=engine.MANEUVER_HOLD)
check("FR-N3: an ACCEPT that does not echo the proposed maneuver is rejected",
      any("ACCEPT must echo" in p for p in engine.validate_exchange(outcome.proposal, silent_accept)))

same_counter = engine.build_response(
    peer, actor, pre, engine.ACTION_COUNTER, 0, maneuver=engine.MANEUVER_ALTITUDE_YIELD
)
check("FR-N4: a COUNTER identical to the proposal is rejected (the old dead check)",
      any("ALTERNATIVE" in p for p in engine.validate_exchange(outcome.proposal, same_counter)))

alt_counter = engine.build_response(peer, actor, pre, engine.ACTION_COUNTER, 0, maneuver=engine.MANEUVER_LATERAL_OFFSET)
check("FR-N4: a genuine alternative COUNTER validates", engine.validate_exchange(outcome.proposal, alt_counter) == [])

reasonless = engine.build_response(peer, actor, pre, engine.ACTION_REJECT, 0, reason="   ")
check(
    "FR-N4: REJECT without a stated reason is rejected",
    any("reason" in p for p in engine.validate_envelope(reasonless)),
)

raised = False
try:
    engine.build_resolution(
        engine.ResolutionBody(maneuver=engine.MANEUVER_HOLD, executor="drone-ghost"),
        actor, peer, pre, 0,
    )
except ValueError:
    raised = True
check("§8.5: a resolution naming an uninvolved drone raises instead of blaming the peer", raised)

print("== FR-N5 fixed tie-break + the fallback path ==")
real_resolver = engine.maneuver_resolves_conflict
engine.maneuver_resolves_conflict = lambda *args, **kwargs: False  # force the deadlock branch
try:
    deadlock = engine.DeterministicNegotiator().negotiate(actor, peer, ts_ms=0)
finally:
    engine.maneuver_resolves_conflict = real_resolver
check("FR-N5: an unresolvable conflict still terminates with exactly one resolution",
      deadlock is not None and deadlock.fallback is True)
check("FR-N5: the response is a REJECT carrying the machine-readable reason",
      deadlock is not None and deadlock.response.action == engine.ACTION_REJECT
      and deadlock.response.payload.get("reason") == engine.REASON_PROPOSAL_DOES_NOT_RESOLVE)
check(
    "FR-N5: Drone A — the lexicographically lower id — yields",
    deadlock is not None and deadlock.resolution.payload.executor == "drone-a",
)
check("FR-N5: the mandated delta stays +30 m even when the yielding drone is BELOW its peer",
      deadlock is not None and deadlock.resolution.payload.to_alt_m == actor.alt_m + 30.0
      and deadlock.resolution.payload.maneuver == engine.MANEUVER_ALTITUDE_YIELD)
check(
    "FR-N5: the fallback exchange itself validates",
    deadlock is not None and engine.validate_exchange(deadlock.proposal, deadlock.response) == [],
)

print("== FR-N7 latency budget ==")
started = time.perf_counter()
for _ in range(200):
    engine.DeterministicNegotiator().negotiate(actor, peer, ts_ms=0)
mean_ms = (time.perf_counter() - started) / 200 * 1000
check(f"FR-N7: deterministic exchange averages {mean_ms:.2f} ms, far inside the 5 s budget", mean_ms < 500.0)

print("== FR-N8 LLM seam ==")
unconfigured = engine.LLMNegotiator(config=engine.LLMConfig(api_key=None))
check("FR-N8: an unconfigured LLM is reported as the deterministic engine", unconfigured.name() == "deterministic")
elapsed_probe = engine.LLMNegotiator(
    config=engine.LLMConfig(api_key="test", base_url="http://127.0.0.1:9/v1", model="x"),
    timeout_s=0.25,
    retries=1,
)
started = time.perf_counter()
killed = elapsed_probe.negotiate(actor, peer, ts_ms=0)
elapsed_s = time.perf_counter() - started
check(
    "FR-N8/S21: a killed LLM endpoint falls back to the deterministic exchange",
    killed is not None
    and killed.fallback is False
    and killed.resolution.model_dump()
    == engine.DeterministicNegotiator().negotiate(actor, peer, ts_ms=0).resolution.model_dump(),
    f"elapsed={elapsed_s:.2f}s",
)
check("FR-N8/S21: the fallback completes well inside the 5 s budget", elapsed_s < 2.0, f"elapsed={elapsed_s:.2f}s")
check("FR-N8: the engine still reports itself as LLM-backed", elapsed_probe.name() == "llm")

captured: dict[str, Any] = {}


class _FakeResponse:
    def __init__(self, body: str) -> None:
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False


def fake_urlopen(request: Any, timeout: float | None = None) -> _FakeResponse:
    captured["url"] = request.full_url
    captured["auth"] = request.get_header("Authorization")
    kind = captured.get("reply", "accept")
    if kind == "accept":
        return _FakeResponse(json.dumps({"choices": [{"message": {"content": json.dumps({"action": "ACCEPT"})}}]}))
    return _FakeResponse("this is not JSON at all")


real_urlopen = engine.urllib.request.urlopen
engine.urllib.request.urlopen = fake_urlopen
try:
    swappable = engine.LLMNegotiator(
        config=engine.LLMConfig(api_key="test", base_url="https://open.bigmodel.cn/api/paas/v4", model="glm-4-flash"),
        timeout_s=1.0, retries=0,
    )
    llm_outcome = swappable.negotiate(actor, peer, ts_ms=0)
    check("FR-N8/S23: a configured provider is reached with the OpenAI-compatible path",
          captured.get("url") == "https://open.bigmodel.cn/api/paas/v4/chat/completions"
          and captured.get("auth") == "Bearer test")
    check(
        "FR-N8: a valid LLM ACCEPT becomes the response",
        llm_outcome is not None and llm_outcome.response.action == engine.ACTION_ACCEPT,
    )
    captured["reply"] = "garbage"
    garbled = engine.LLMNegotiator(
        config=engine.LLMConfig(api_key="test", base_url="https://example.invalid/v1", model="qwen3"),
        timeout_s=1.0, retries=1,
    ).negotiate(actor, peer, ts_ms=0)
    check("FR-N8/S23: switching model+base_url needs no code change, and garbage output falls back",
          garbled is not None and garbled.fallback is False
          and captured.get("url") == "https://example.invalid/v1/chat/completions")
finally:
    engine.urllib.request.urlopen = real_urlopen

print()
if failures:
    print(f"{failures} CHECK(S) FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
