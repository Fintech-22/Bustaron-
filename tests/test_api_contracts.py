"""HTTP contract tests for the M3 backend (PRD S1, S6, S91).

Driven in-process through FastAPI's `TestClient`, so no port is bound and these tests cannot
collide with `server/probe_api.py` (which owns `:8000`). `conftest.py` pins the data directory
to a temp dir, so `server/data/state.json` is never touched either.

These assert the *contract*: status codes, error codes, and the presence/shape of fields a
client branches on. The behavioural, cross-process, real-socket coverage stays in
`server/probe_api.py` — duplicating that here would create two sources of truth.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from server import main as server_main
from tests.helpers import track_payload

CONFLICT_OWN = track_payload("A", lat=22.3000, lng=114.1700, alt_m=100.0, battery_pct=80.0)
CONFLICT_PEER = track_payload("B", lat=22.3005, lng=114.1700, alt_m=100.0, battery_pct=50.0)
CLEAR_PEER = track_payload("B", lat=22.3500, lng=114.2000, alt_m=100.0, battery_pct=50.0)


def _corrupt_the_chain() -> None:
    """Rewrites block 1's txs WITHOUT recomputing its hash — a genuine FR-B4 integrity fault.

    Mutating the file on disk (rather than an in-memory object) is deliberate: every request
    calls `load_state()`, so this is the same thing an attacker with file access would do.
    """
    state = server_main.load_state()
    server_main.seed_if_empty(state)
    server_main.append_block(state, [{"type": "REAL"}])
    state.blocks[1].txs = [{"type": "FORGED"}]
    server_main.save_state(state)


# --------------------------------------------------------------- health (S4 surface)


def test_health_reports_a_valid_chain_on_a_fresh_seed(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["chainValid"] is True
    assert body["tamperDetected"] is False
    assert body["chainFault"] is None
    assert body["chainFaultCode"] is None


def test_health_exposes_the_machine_readable_fault_fields(client: TestClient) -> None:
    """S4: a poller must branch on these without parsing prose."""
    body = client.get("/api/health").json()
    for field in ("chainValid", "tamperDetected", "chainFault", "chainFaultCode",
                  "chainFaultHeight", "tamperEventCount", "eventSubscribers"):
        assert field in body


def test_health_reports_the_seeded_tables(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["wallets"] == 3
    assert body["auctions"] == 2
    assert body["chainHeight"] >= 1


def test_health_stays_200_and_reports_invalid_on_a_corrupt_chain(client: TestClient) -> None:
    """`status` is LIVENESS only. A tampered chain still serves, with chainValid false —
    a 500 here would hide the tamper from every poller."""
    _corrupt_the_chain()
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["chainValid"] is False
    assert body["tamperDetected"] is True
    assert body["chainFaultCode"] == "BLOCK_HASH_MISMATCH"
    assert body["chainFaultHeight"] == 1


# --------------------------------------------------------------- chain reads (S6)


def test_chain_returns_height_valid_and_blocks(client: TestClient) -> None:
    body = client.get("/chain").json()
    assert body["height"] == len(body["blocks"]) >= 1
    assert body["valid"] is True


def test_chain_blocks_carry_a_three_of_three_sigs_map(client: TestClient) -> None:
    """S3: the signatures must be AUDITABLE on the read surface, not hidden."""
    for block in client.get("/chain").json()["blocks"]:
        assert set(block["sigs"].keys()) == {"node:admin", "node:agent_a", "node:agent_b"}


def test_block_by_height_returns_the_block(client: TestClient) -> None:
    body = client.get("/block/0").json()
    assert body["height"] == 0
    assert body["prev_hash"] == "0" * 64


def test_block_by_unknown_height_is_404(client: TestClient) -> None:
    assert client.get("/block/999").status_code == 404


# --------------------------------------------------------------- read endpoints (S6)


def test_wallets_endpoint_returns_the_seeded_balances(client: TestClient) -> None:
    wallets = {wallet["id"]: wallet for wallet in client.get("/api/wallets").json()}
    assert wallets["wallet-harbour"]["balanceCredits"] == 480
    assert wallets["wallet-harbour"]["reservedCredits"] == 40
    assert wallets["wallet-urban"]["balanceCredits"] == 260
    assert wallets["wallet-cargo"]["balanceCredits"] == 640


def test_auctions_endpoint_returns_rows(client: TestClient) -> None:
    auctions = client.get("/api/auctions").json()
    assert len(auctions) == 2


def test_approvals_endpoint_returns_rows(client: TestClient) -> None:
    assert len(client.get("/api/approvals").json()) >= 1


def test_ledger_endpoint_returns_a_list(client: TestClient) -> None:
    assert isinstance(client.get("/api/ledger").json(), list)


def test_fleet_endpoint_returns_a_non_empty_seeded_roster(client: TestClient) -> None:
    """North-star bullet 5: real rows, not an empty array beside a populated mock UI."""
    fleet = client.get("/api/fleet").json()
    assert isinstance(fleet, list) and fleet
    for drone in fleet:
        assert {"id", "callsign", "operatorId", "batteryPct", "status", "position"} <= set(drone)


def test_missions_endpoint_returns_a_non_empty_seeded_list(client: TestClient) -> None:
    missions = client.get("/api/missions").json()
    assert isinstance(missions, list) and missions
    for mission in missions:
        assert {"id", "name", "route", "status", "riskLevel"} <= set(mission)


def test_zones_endpoint_serves_the_cad_pack(client: TestClient) -> None:
    zones = client.get("/api/zones").json()
    assert len(zones.get("features", [])) == 284


def test_weather_endpoint_answers_with_the_documented_fields(client: TestClient) -> None:
    """S35-S40 surface. Freshness is deliberately NOT asserted — the HKO poller's TTL
    behaviour is covered by `server/probe_weather.py`, which controls the cache."""
    body = client.get("/api/weather").json()
    assert "stale" in body
    assert "pathCostFactor" in body


# --------------------------------------------------------------- SSE (S6)


def test_events_route_is_registered() -> None:
    """S6 / FR-B8 requires a `GET /events` stream endpoint to exist.

    WHY THIS DOES NOT CONSUME THE STREAM — a deliberate scope boundary, not an omission.
    `TestClient` runs the ASGI app through a portal and cannot cancel an infinite async
    generator, so reading `/events` in-process **deadlocks the whole test session** (measured:
    the run hung until an external timeout killed it). The stream's SEMANTICS — SSE content
    type, chunked framing with no Content-Length, history replay, the `: replay-complete`
    boundary, live delivery within one append cycle, and fan-out to concurrent subscribers —
    are covered over a real socket by `server/probe_api.py` (25 S6 assertions), including the
    acid test that fails when live delivery is disabled.

    So: assert the route exists here (cheap, in-process, catches an accidental deletion), and
    leave the wire behaviour to the one harness that can actually observe it. Duplicating the
    rest would create a second source of truth for a contract that already has a stronger one.
    """
    paths = {getattr(route, "path", None) for route in server_main.app.routes}
    assert "/events" in paths


# --------------------------------------------------------------- tx submission (S1)


def test_bid_above_reserve_is_accepted_and_anchored(client: TestClient) -> None:
    height_before = client.get("/chain").json()["height"]
    response = client.post(
        "/chain/tx",
        json={"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning",
                                                "walletId": "wallet-harbour", "credits": 90}},
    )
    assert response.status_code == 200
    assert response.json()["blockHash"]
    assert client.get("/chain").json()["height"] == height_before + 1


def test_bid_below_reserve_is_422(client: TestClient) -> None:
    response = client.post(
        "/chain/tx",
        json={"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning",
                                                "walletId": "wallet-harbour", "credits": 5}},
    )
    assert response.status_code == 422
    assert "reserve" in response.json()["detail"]


def test_rejection_without_a_reason_is_refused(client: TestClient) -> None:
    """PRD defect 4 / S121: a rejection must state why."""
    response = client.post(
        "/chain/tx",
        json={"type": "APPROVAL_DECIDE", "payload": {"approvalId": "approval-cbd-04",
                                                     "decision": "rejected"}},
    )
    assert response.status_code == 422
    assert "reason is required" in response.json()["detail"]


def test_an_unknown_tx_type_is_refused_by_the_schema_not_at_runtime(client: TestClient) -> None:
    """The TXType union exists so an unsupported type fails validation (422) rather than
    reaching the dispatcher and producing a confusing 400 from the `else` branch."""
    response = client.post("/chain/tx", json={"type": "NOT_A_REAL_TYPE", "payload": {}})
    assert response.status_code == 422


def test_negotiation_is_not_client_submittable(client: TestClient) -> None:
    """NEGOTIATION is server-minted (like GENESIS). If it were advertised in `TXType` but
    unhandled, it would become the next 'advertised but 400' trap the audit flagged."""
    response = client.post("/chain/tx", json={"type": "NEGOTIATION", "payload": {}})
    assert response.status_code == 422


# --------------------------------------------------------------- FR-B6 refusal


def test_appending_to_a_corrupt_chain_is_refused_with_409(client: TestClient) -> None:
    _corrupt_the_chain()
    response = client.post(
        "/chain/tx",
        json={"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning",
                                                "walletId": "wallet-harbour", "credits": 90}},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["tamperDetected"] is True
    assert body["chainFaultCode"] == "BLOCK_HASH_MISMATCH"


def test_a_refused_append_changes_nothing(client: TestClient) -> None:
    """FR-B6: the `apply_*` mutation must not run, so no block is appended and no wallet
    moves — a refusal that still mutates would be worse than no refusal at all."""
    _corrupt_the_chain()
    height_before = client.get("/chain").json()["height"]
    wallets_before = client.get("/api/wallets").json()
    client.post(
        "/chain/tx",
        json={"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning",
                                                "walletId": "wallet-harbour", "credits": 90}},
    )
    assert client.get("/chain").json()["height"] == height_before
    assert client.get("/api/wallets").json() == wallets_before


def test_a_refused_append_is_recorded_as_a_durable_tamper_event(client: TestClient) -> None:
    _corrupt_the_chain()
    before = client.get("/api/health").json()["tamperEventCount"]
    client.post(
        "/chain/tx",
        json={"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning",
                                                "walletId": "wallet-harbour", "credits": 90}},
    )
    assert client.get("/api/health").json()["tamperEventCount"] == before + 1


def test_negotiate_is_refused_on_a_corrupt_chain(client: TestClient) -> None:
    """The negotiation path must inherit the FR-B6 refusal — anchoring a resolution onto a
    chain already declared untrustworthy would be self-contradictory."""
    _corrupt_the_chain()
    response = client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER})
    assert response.status_code == 409
    assert response.json()["tamperDetected"] is True


# --------------------------------------------------------------- negotiation anchoring


def test_negotiate_anchors_three_blocks_for_a_conflict(client: TestClient) -> None:
    """FR-N6 / S25: proposal, response and resolution each get their own block, in order."""
    height_before = client.get("/chain").json()["height"]
    body = client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER}).json()
    assert body["ok"] is True
    assert body["conflict"] is not None
    assert len(body["blocks"]) == 3
    assert client.get("/chain").json()["height"] == height_before + 3


def test_negotiate_anchors_nothing_when_there_is_no_conflict(client: TestClient) -> None:
    """An empty exchange is not an event — anchoring it would put a non-event on the chain."""
    height_before = client.get("/chain").json()["height"]
    body = client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CLEAR_PEER}).json()
    assert body["conflict"] is None
    assert body["blocks"] == []
    assert client.get("/chain").json()["height"] == height_before


def test_negotiate_reports_a_measured_latency(client: TestClient) -> None:
    body = client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER}).json()
    assert isinstance(body.get("latencyMs"), int)
    assert body["latencyMs"] >= 0


def test_negotiate_reports_its_engine_and_weather_staleness(client: TestClient) -> None:
    """The engine name and the weather flag must be reported, not implied — an operator
    needs to know whether a decision came from the deterministic policy or an LLM."""
    body = client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER}).json()
    assert body["engine"] == "deterministic"
    # No snapshot supplied => the detail block must say the evidence came from the cache and
    # must carry the staleness flag, so a caller can tell live HKO data from a stale cache.
    assert body["weather"]["source"] == "cache"
    assert "stale" in body["weather"]


def test_negotiations_endpoint_replays_the_anchored_exchange(client: TestClient) -> None:
    """S25: the chain IS the store. The replay is reconstructed from BLOCKS, so a message
    cannot be replayed unless it was genuinely anchored."""
    client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER})
    body = client.get("/negotiations").json()

    assert body["chainValid"] is True
    assert len(body["negotiations"]) == 1
    group = body["negotiations"][0]
    assert group["conflictId"].startswith("cf_")
    assert len(group["messages"]) == 3          # proposal, response, resolution
    assert len(group["blocks"]) == 3
    heights = [entry["height"] for entry in group["blocks"]]
    assert heights == sorted(heights) and len(set(heights)) == 3


def test_negotiation_latency_is_derived_from_block_timestamps(client: TestClient) -> None:
    """S22: the latency evidence must come from the CHAIN, not from the envelopes' own
    `ts_ms` — otherwise a client could report any latency it liked."""
    client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER})
    group = client.get("/negotiations").json()["negotiations"][0]
    expected = group["blocks"][-1]["tsMs"] - group["blocks"][0]["tsMs"]
    assert group["latencyMs"] == expected


def test_negotiation_replay_is_grouped_by_conflict_id(client: TestClient) -> None:
    """All three messages of one exchange must land in ONE group, or a client cannot
    reconstruct the decision."""
    client.post("/negotiate", json={"own": CONFLICT_OWN, "peer": CONFLICT_PEER})
    group = client.get("/negotiations").json()["negotiations"][0]
    assert {message["conflict_id"] for message in group["messages"]} == {group["conflictId"]}


def test_negotiations_is_empty_before_any_exchange(client: TestClient) -> None:
    """No exchange => no groups. An empty replay is not an error."""
    body = client.get("/negotiations").json()
    assert body["negotiations"] == []
    assert body["chainValid"] is True
