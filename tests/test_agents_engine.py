"""PRD §8 negotiation engine — pure-logic tests (no server, no socket).

Covers FR-N1..FR-N8 at the level of `server/agents.py` alone. The HTTP/anchoring half lives
in `test_negotiation_anchoring.py`.

Several tests here are **regression tests for defects that actually shipped** in the first
version of this engine (found during the B4 review, recorded in TRACE run 3). They are marked
`Regression:` and named after the failure, because a test that only asserts "it runs" would
not have caught any of them.
"""

from __future__ import annotations

import pytest

from server.agents import (
    ACTION_ACCEPT,
    ACTION_COUNTER,
    ACTION_PROPOSE,
    ACTION_REJECT,
    ALTITUDE_YIELD_DELTA_M,
    FR_N5_YIELD_DELTA_M,
    LATERAL_OFFSET_M,
    MANEUVER_ALTITUDE_YIELD,
    MANEUVER_HOLD,
    MANEUVER_MENU,
    MANEUVER_REROUTE,
    MANEUVER_SLOW,
    MIN_SEPARATION_M,
    PREDICTION_HORIZON_S,
    SLOW_FACTOR,
    DeterministicNegotiator,
    DroneTrack,
    apply_maneuver,
    cheapest_resolving_maneuver,
    conflict_id_for,
    detect_conflict,
    fr_n5_fallback,
    llm_config_from_env,
    maneuver_resolves_conflict,
    predict_positions,
    select_proposer,
    skycell_of,
    validate_envelope,
    validate_exchange,
    yield_direction,
)
from tests.helpers import make_track

# --------------------------------------------------------------- the fixed menu (FR-N3)


def test_maneuver_menu_is_exactly_the_five_prd_maneuvers() -> None:
    """FR-N3 names the menu; anything extra would let a negotiation propose something the
    PRD never authorised."""
    assert set(MANEUVER_MENU) == {
        "HOLD",
        "ALTITUDE_YIELD",
        "LATERAL_OFFSET",
        "SLOW",
        "REROUTE",
    }
    assert len(MANEUVER_MENU) == 5


def test_maneuver_menu_order_is_the_documented_cost_order() -> None:
    """The deterministic policy depends on the order (cheapest first), so pin it."""
    assert MANEUVER_MENU == (MANEUVER_HOLD, MANEUVER_SLOW, MANEUVER_ALTITUDE_YIELD,
                             "LATERAL_OFFSET", MANEUVER_REROUTE)


def test_prd_numeric_constants_match_the_spec() -> None:
    """§8.2/§8.3 numbers: 150 m, 10 s, ±30 m, 250 m, 50%."""
    assert MIN_SEPARATION_M == 150.0
    assert PREDICTION_HORIZON_S == 10
    assert ALTITUDE_YIELD_DELTA_M == 30.0
    assert LATERAL_OFFSET_M == 250.0
    assert SLOW_FACTOR == 0.5
    assert FR_N5_YIELD_DELTA_M == 30.0


# --------------------------------------------------------------- prediction (FR-N1)


def test_predict_positions_returns_one_sample_per_second_across_the_window() -> None:
    """FR-N1 says predict 10 s ahead; the engine scans every 1 s sample of that window."""
    samples = predict_positions(make_track("A"))
    assert len(samples) == PREDICTION_HORIZON_S + 1  # t=0 .. t=10 inclusive


def test_prediction_is_linear_in_velocity() -> None:
    """A drone moving north at 10 m/s is ~100 m north after 10 s."""
    track = make_track("A", vel_n_mps=10.0)
    samples = predict_positions(track)
    first, last = samples[0], samples[-1]
    north_delta_m = (last["lat"] - first["lat"]) * 111_320.0
    assert north_delta_m == pytest.approx(100.0, abs=1.0)


def test_stationary_drone_predicts_a_constant_position() -> None:
    """No velocity => every sample is the same point. Guards the velocity wiring."""
    samples = predict_positions(make_track("A"))
    assert len({(round(s["lat"], 9), round(s["lng"], 9)) for s in samples}) == 1


# --------------------------------------------------------------- skycell grid


def test_skycell_of_is_stable_for_the_same_point() -> None:
    assert skycell_of(22.30, 114.17) == skycell_of(22.30, 114.17)


def test_skycell_of_advances_one_cell_per_600m_north() -> None:
    """The grid reuses the frontend's 600 m skycell lattice, so one cell north of a point
    is one row up — the property that makes "same grid cell" mean the same thing in the
    engine and on the operator's map."""
    row_a, col_a = skycell_of(22.30, 114.17)
    row_b, col_b = skycell_of(22.30 + 600.0 / 111_320.0, 114.17)
    assert (row_b, col_b) == (row_a + 1, col_a)


def test_distant_points_land_in_different_cells() -> None:
    assert skycell_of(22.30, 114.17) != skycell_of(22.35, 114.20)


# --------------------------------------------------------------- conflict id (FR-N2)


def test_conflict_id_is_deterministic() -> None:
    """FR-N2 says 'deterministic'. Same inputs must give the same id, or a re-detection
    would open a second negotiation for one conflict."""
    assert conflict_id_for("A", "B", 0) == conflict_id_for("A", "B", 0)


def test_conflict_id_is_order_independent_on_the_pair() -> None:
    """The pair is canonicalised, so (A,B) and (B,A) are the same conflict."""
    assert conflict_id_for("A", "B", 0) == conflict_id_for("B", "A", 0)


def test_conflict_id_changes_with_the_pair_and_the_window() -> None:
    assert conflict_id_for("A", "B", 0) != conflict_id_for("A", "C", 0)
    assert conflict_id_for("A", "B", 0) != conflict_id_for("A", "B", 10)


def test_conflict_id_is_not_a_uuid_or_a_timestamp() -> None:
    """A uuid/timestamp id would make the SAME conflict yield a new id on every tick, which
    is exactly how a caller could dodge FR-N5 by simply waiting."""
    conflict_id = conflict_id_for("A", "B", 0)
    assert conflict_id.startswith("cf_")
    assert len(conflict_id) == len("cf_") + 8  # 8 hex chars of the digest
    assert conflict_id == conflict_id_for("A", "B", 0)  # no time salt


# --------------------------------------------------------------- detection (FR-N2)


def test_close_pair_produces_a_conflict(conflicting_pair: tuple[DroneTrack, DroneTrack]) -> None:
    own, peer = conflicting_pair
    conflict = detect_conflict(own, peer)
    assert conflict is not None
    assert conflict.min_separation_m < MIN_SEPARATION_M


def test_distant_pair_produces_no_conflict(clear_pair: tuple[DroneTrack, DroneTrack]) -> None:
    own, peer = clear_pair
    assert detect_conflict(own, peer) is None


def test_detection_canonicalises_drone_a_as_the_lower_id(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """`drone_a` is the lexicographically lower id regardless of argument order — FR-N5's
    tie-break is defined in terms of 'Drone A', so this ordering is load-bearing."""
    own, peer = conflicting_pair
    forward = detect_conflict(own, peer)
    reverse = detect_conflict(peer, own)
    assert forward is not None and reverse is not None
    assert forward.drone_a == "A"
    assert reverse.drone_a == "A"
    assert forward.conflict_id == reverse.conflict_id


def test_detection_rejects_a_drone_conflicting_with_itself() -> None:
    """Silently returning None here would hide a caller bug that disables deconfliction."""
    track = make_track("A")
    with pytest.raises(ValueError):
        detect_conflict(track, track)


def test_detection_reports_a_reason_naming_the_branch_that_fired(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    conflict = detect_conflict(own, peer)
    assert conflict is not None
    assert "SEPARATION" in conflict.reason


# --------------------------------------------------------------- yield sign (regression)


def test_yield_direction_climbs_when_at_or_above_the_peer() -> None:
    assert yield_direction(120.0, 100.0) == 1.0
    assert yield_direction(100.0, 100.0) == 1.0


def test_yield_direction_descends_when_below_the_peer() -> None:
    """Regression: the engine once always climbed. Climbing while BELOW the peer reduces the
    vertical gap, i.e. the opposite of the manoeuvre's documented intent."""
    assert yield_direction(80.0, 100.0) == -1.0


def test_altitude_yield_increases_separation_when_below_the_peer() -> None:
    """The property the sign exists for, asserted directly on separation rather than on the
    sign, so it holds however the helper is refactored."""
    own = make_track("A", alt_m=80.0)
    peer = make_track("B", alt_m=100.0)
    direction = yield_direction(own.alt_m, peer.alt_m)
    moved = apply_maneuver(own, MANEUVER_ALTITUDE_YIELD, peer_alt_m=peer.alt_m)
    assert moved.alt_m == pytest.approx(80.0 + direction * ALTITUDE_YIELD_DELTA_M)
    assert abs(moved.alt_m - peer.alt_m) > abs(own.alt_m - peer.alt_m)


# --------------------------------------------------------------- manoeuvre effects


def test_hold_stops_the_drone() -> None:
    moved = apply_maneuver(make_track("A", vel_n_mps=20.0), MANEUVER_HOLD)
    assert moved.vel_n_mps == 0.0 and moved.vel_e_mps == 0.0


def test_slow_halves_speed() -> None:
    moved = apply_maneuver(make_track("A", vel_n_mps=20.0, vel_e_mps=10.0), MANEUVER_SLOW)
    assert moved.vel_n_mps == pytest.approx(10.0)
    assert moved.vel_e_mps == pytest.approx(5.0)


def test_lateral_offset_moves_the_drone_250m_off_track() -> None:
    """250 m perpendicular to heading, per the menu."""
    track = make_track("A", lat=22.30, lng=114.17)
    moved = apply_maneuver(track, "LATERAL_OFFSET")
    north_m = (moved.lat - track.lat) * 111_320.0
    east_m = (moved.lng - track.lng) * (111_320.0 * 0.9245)  # cos(22.31°) approx
    assert (north_m**2 + east_m**2) ** 0.5 == pytest.approx(LATERAL_OFFSET_M, rel=0.02)


def test_apply_maneuver_rejects_a_maneuver_outside_the_menu() -> None:
    """A free-form manoeuvre would let the engine propose something FR-N3 never authorised."""
    with pytest.raises(ValueError):
        apply_maneuver(make_track("A"), "BARREL_ROLL")


def test_reroute_displaces_the_track_by_one_skycell() -> None:
    """REROUTE means "leave the current corridor", so it must actually move the drone out of
    the cell it is in — a no-op REROUTE would silently be HOLD wearing a different name."""
    own = make_track("A", lat=22.30, lng=114.17)
    moved = apply_maneuver(own, MANEUVER_REROUTE)
    assert (moved.lat, moved.lng) != (own.lat, own.lng)
    assert skycell_of(moved.lat, moved.lng) != skycell_of(own.lat, own.lng)


def test_reroute_counts_as_resolving() -> None:
    """The policy's totality depends on REROUTE always resolving; pin that, because if it
    stopped resolving `cheapest_resolving_maneuver` could return None and FR-N8's
    never-deadlock guarantee would rest on nothing."""
    own, peer = make_track("A"), make_track("B")
    assert maneuver_resolves_conflict(own, peer, MANEUVER_REROUTE)


# --------------------------------------------------------------- proposer (FR-N3)


def test_lower_battery_drone_proposes() -> None:
    own = make_track("A", battery_pct=80.0)
    peer = make_track("B", battery_pct=50.0)
    proposer, responder = select_proposer(own, peer)
    assert proposer.id == "B" and responder.id == "A"


def test_battery_tie_is_broken_by_lower_drone_id() -> None:
    own = make_track("B", battery_pct=50.0)
    peer = make_track("A", battery_pct=50.0)
    proposer, responder = select_proposer(own, peer)
    assert proposer.id == "A" and responder.id == "B"


def test_proposer_selection_is_independent_of_argument_order() -> None:
    a = make_track("A", battery_pct=50.0)
    b = make_track("B", battery_pct=50.0)
    assert select_proposer(a, b)[0].id == select_proposer(b, a)[0].id


# --------------------------------------------------------------- FR-N5 tie-break


def test_fr_n5_fallback_is_drone_a_yielding_up_30m() -> None:
    """FR-N5, verbatim: 'Drone A (lower ID) yields altitude +30 m.'"""
    own = make_track("B", alt_m=100.0)
    peer = make_track("A", alt_m=200.0)
    resolution = fr_n5_fallback(own, peer)
    assert resolution.maneuver == MANEUVER_ALTITUDE_YIELD
    assert resolution.executor == "A"          # lower id, NOT the lower drone
    assert resolution.from_alt_m == 200.0
    assert resolution.to_alt_m == 230.0        # +30 m, unconditional
    assert "FR-N5" in resolution.detail


def test_fr_n5_fallback_ignores_battery() -> None:
    """The tie-break is mandated, not negotiated — battery must not influence it."""
    own = make_track("B", battery_pct=1.0, alt_m=100.0)
    peer = make_track("A", battery_pct=99.0, alt_m=100.0)
    assert fr_n5_fallback(own, peer).executor == "A"


def test_fr_n5_fallback_is_deterministic_across_calls() -> None:
    own, peer = make_track("A", alt_m=90.0), make_track("B", alt_m=90.0)
    first, second = fr_n5_fallback(own, peer), fr_n5_fallback(own, peer)
    assert first.model_dump() == second.model_dump()


# --------------------------------------------------------------- cheapest resolving


def test_cheapest_resolving_maneuver_is_always_a_menu_member(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    assert cheapest_resolving_maneuver(own, peer) in MANEUVER_MENU


def test_cheapest_resolving_maneuver_is_total(conflicting_pair: tuple[DroneTrack, DroneTrack]) -> None:
    """The policy must never fail to find a manoeuvre — REROUTE guarantees termination,
    which is what stops the engine deadlocking (the property FR-N8 exists to protect)."""
    own, peer = conflicting_pair
    assert cheapest_resolving_maneuver(own, peer) is not None


# --------------------------------------------------------------- the deterministic policy


def test_deterministic_negotiator_returns_none_without_a_conflict(
    clear_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """No conflict => no negotiation. Anchoring an empty exchange would put a non-event on
    the chain."""
    own, peer = clear_pair
    assert DeterministicNegotiator().negotiate(own, peer) is None


def test_deterministic_negotiator_produces_a_proposal_a_response_and_a_resolution(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert outcome.proposal.action == ACTION_PROPOSE
    assert outcome.response.action in {ACTION_ACCEPT, ACTION_COUNTER, ACTION_REJECT}
    assert outcome.resolution.action == "RESOLVE"


def test_deterministic_negotiator_response_round_is_two(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert outcome.proposal.round == 1
    assert outcome.response.round == 2
    assert outcome.resolution.round == 3


def test_deterministic_negotiator_addresses_the_right_peers(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """The proposal goes proposer -> responder and the response comes back the other way.
    Asserted against the public `select_proposer` rather than an internal attribute, so the
    test pins the FR-N3 rule and not an implementation detail.

    NOTE: `from`/`to` carry the BARE drone id ("B"), whereas the §8.5 example spells them
    "drone:B". The example is illustrative and the engine is self-consistent (the chain
    replay groups by `conflict_id`, not by these fields), so this pins the shipped wire
    format deliberately — recorded in TRACE as a minor §8.5-example divergence rather than
    quietly asserted as correct."""
    own, peer = conflicting_pair
    proposer, responder = select_proposer(own, peer)
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert outcome.proposal.from_ == proposer.id
    assert outcome.proposal.to == responder.id
    assert outcome.response.from_ == responder.id
    assert outcome.response.to == proposer.id


def test_every_envelope_carries_the_same_conflict_id(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """All three messages must belong to ONE conflict, or the chain replay cannot group them."""
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    ids = {outcome.proposal.conflict_id, outcome.response.conflict_id, outcome.resolution.conflict_id}
    assert len(ids) == 1
    assert ids == {outcome.conflict.conflict_id}


def test_deterministic_negotiator_is_reproducible(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """Same inputs, same exchange — the property that makes the fallback trustworthy."""
    own, peer = conflicting_pair
    first = DeterministicNegotiator().negotiate(own, peer, ts_ms=1000)
    second = DeterministicNegotiator().negotiate(own, peer, ts_ms=1000)
    assert first is not None and second is not None
    assert first.proposal.model_dump() == second.proposal.model_dump()
    assert first.resolution.model_dump() == second.resolution.model_dump()


def test_deterministic_negotiator_always_terminates_with_a_resolution(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """FR-N8's real requirement: the mission never deadlocks on the decision layer."""
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert outcome.resolution.payload.maneuver in MANEUVER_MENU
    assert outcome.resolution.payload.executor in {own.id, peer.id}


# --------------------------------------------------------------- envelope validation


def test_a_well_formed_proposal_validates_clean(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert validate_envelope(outcome.proposal) == []


def test_validate_envelope_rejects_an_unknown_maneuver(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    broken = outcome.proposal.model_copy(deep=True)
    broken.payload["maneuver"] = "BARREL_ROLL"
    assert validate_envelope(broken)


def test_validate_envelope_rejects_a_propose_with_no_maneuver(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    broken = outcome.proposal.model_copy(deep=True)
    broken.payload.pop("maneuver", None)
    assert validate_envelope(broken)


def test_validate_exchange_rejects_a_conflict_id_mismatch(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """A response answering a different conflict is the kind of cross-talk the chain must
    never anchor."""
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    mismatched = outcome.response.model_copy(deep=True)
    mismatched.conflict_id = "cf_deadbeef0000"
    assert validate_exchange(outcome.proposal, mismatched)


def test_validate_exchange_accepts_the_engines_own_exchange(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert validate_exchange(outcome.proposal, outcome.response) == []


def test_envelope_serialises_from_as_the_prd_field_name(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """§8.5 spells the field `from`. The wire format is the contract, so assert the alias
    rather than the Python attribute name."""
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    dumped = outcome.proposal.model_dump(by_alias=True)
    assert "from" in dumped and "from_" not in dumped
    assert dumped["type"] == "negotiation"


# --------------------------------------------------------------- evidence (§8.5 / FR-W2)


def test_evidence_reports_weather_stale_when_no_snapshot_is_supplied(
    conflicting_pair: tuple[DroneTrack, DroneTrack],
) -> None:
    """FR-W2 requires a cited wind value to match the cached HKO reading. With no snapshot
    the honest answer is stale + no number — inventing one would fabricate evidence."""
    own, peer = conflicting_pair
    outcome = DeterministicNegotiator().negotiate(own, peer)
    assert outcome is not None
    assert outcome.proposal.evidence.weather_stale is True
    assert outcome.proposal.evidence.wind_kmh is None


# --------------------------------------------------------------- LLM seam (FR-N8)


def test_llm_config_is_absent_without_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """With no provider key the deterministic path is the one that runs — which is the
    configuration this whole environment is in."""
    for var in ("BUSTARON_LLM_API_KEY", "BUSTARON_LLM_BASE_URL", "BUSTARON_LLM_MODEL"):
        monkeypatch.delenv(var, raising=False)
    config = llm_config_from_env()
    assert config.configured is False
    assert config.api_key is None


def test_llm_config_defaults_to_the_prd_named_free_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """§8.1: provider-agnostic, default Zhipu GLM-4-Flash."""
    monkeypatch.setenv("BUSTARON_LLM_API_KEY", "test-key")
    monkeypatch.delenv("BUSTARON_LLM_MODEL", raising=False)
    config = llm_config_from_env()
    assert config.configured is True
    assert config.model == "glm-4-flash"


def test_llm_config_honours_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BUSTARON_LLM_API_KEY", "test-key")
    monkeypatch.setenv("BUSTARON_LLM_MODEL", "qwen-plus")
    monkeypatch.setenv("BUSTARON_LLM_BASE_URL", "https://example.test/v1")
    config = llm_config_from_env()
    assert config.model == "qwen-plus"
    assert config.base_url == "https://example.test/v1"


def test_llm_config_characterises_a_whitespace_key_as_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CHARACTERIZATION TEST — pins the CURRENT behaviour of a known, unfixed gap.

    `llm_config_from_env()` does `os.environ.get(...) or None`, which does not strip, so a
    whitespace-only key counts as configured. The consequence is bounded but real: the LLM
    negotiator is attempted, fails auth, retries twice at `LLM_ATTEMPT_TIMEOUT_S` each, and
    only then falls back — burning up to 4 s of FR-N7's 5 s budget to reach the same
    deterministic answer it would have reached immediately.

    It is NOT fixed here on purpose: this suite is S91 (test coverage), and `server/agents.py`
    is a separately reviewed and verified artifact. Changing its behaviour belongs in its own
    reviewed change. Recorded as an open finding in TRACE so it is visible rather than
    quietly asserted as correct.

    The frontend already trims the analogous value (`VITE_MAPBOX_TOKEN`), so the one-line fix
    is `(os.environ.get("BUSTARON_LLM_API_KEY") or "").strip() or None`.
    """
    monkeypatch.setenv("BUSTARON_LLM_API_KEY", "   ")
    assert llm_config_from_env().configured is True  # the gap: should be False


def test_llm_config_ignores_an_absent_key_entirely(monkeypatch: pytest.MonkeyPatch) -> None:
    """The complementary, correct case: genuinely unset => deterministic path, no client."""
    monkeypatch.delenv("BUSTARON_LLM_API_KEY", raising=False)
    config = llm_config_from_env()
    assert config.api_key is None
    assert config.configured is False
