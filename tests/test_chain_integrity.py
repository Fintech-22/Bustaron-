"""Hash-chain, quorum and state-persistence tests (PRD FR-B4, FR-B5, FR-B6, S2, S3, S4, S91).

Exercises `server/main.py` + `server/authorities.py` in process, against the isolated data
directory established by `conftest.py`. No socket is opened, so these tests cannot collide
with `server/probe_api.py`, which owns `:8000` and the real `server/data/state.json`.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from server import main as server_main
from server.authorities import AUTHORITY_IDS, sign_block_hash, verify_quorum, verify_signature
from server.main import (
    FAULT_BLOCK_HASH,
    FAULT_QUORUM_INVALID,
    MAX_TAMPER_EVENTS,
    Block,
    State,
    _hash,
    _record_tamper_event,
    append_block,
    load_state,
    save_state,
    seed_if_empty,
    verify_chain,
)


@pytest.fixture()
def seeded_state() -> State:
    """A pristine, fully seeded `State` — the same starting point the server boots into."""
    server_main.STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    server_main.STATE_PATH.write_text("{}", "utf-8")
    state = load_state()
    seed_if_empty(state)
    return state


def _fault_code(state: State) -> str | None:
    fault = server_main._chain_fault(state)
    return None if fault is None else fault.code


# --------------------------------------------------------------- block hashing (FR-B4)


def test_hash_is_deterministic() -> None:
    payload = {"height": 1, "prev_hash": "ab" * 32, "ts_ms": 123, "txs": []}
    assert _hash(payload) == _hash(payload)


def test_hash_is_64_hex_characters() -> None:
    digest = _hash({"height": 0, "prev_hash": "0" * 64, "ts_ms": 1, "txs": []})
    assert len(digest) == 64
    assert all(char in "0123456789abcdef" for char in digest)


def test_hash_changes_when_the_payload_changes() -> None:
    base = {"height": 1, "prev_hash": "0" * 64, "ts_ms": 1, "txs": []}
    changed = {**base, "height": 2}
    assert _hash(base) != _hash(changed)


def test_block_hash_covers_exactly_the_four_signed_fields(seeded_state: State) -> None:
    """`_hash` must exclude `sigs` and `proposer` — the signatures commit to the hash, so
    folding `sigs` in would create a hash/signature cycle. Recomputing the documented payload
    and matching the stored hash pins that exclusion: adding either field breaks this."""
    block = seeded_state.blocks[-1]
    recomputed = _hash(
        {
            "height": block.height,
            "prev_hash": block.prev_hash,
            "ts_ms": block.ts_ms,
            "txs": block.txs,
        }
    )
    assert recomputed == block.hash


# --------------------------------------------------------------- linkage (FR-B4 / S2)


def test_genesis_uses_64_zeros_as_its_previous_hash(seeded_state: State) -> None:
    assert seeded_state.blocks[0].height == 0
    assert seeded_state.blocks[0].prev_hash == "0" * 64


def test_seeded_chain_has_exactly_one_block(seeded_state: State) -> None:
    """First boot mints the genesis block only — nothing else may be appended implicitly."""
    assert len(seeded_state.blocks) == 1


def test_append_block_links_to_its_predecessor(seeded_state: State) -> None:
    previous = seeded_state.blocks[-1]
    appended = append_block(seeded_state, [{"type": "TEST"}])
    assert appended.prev_hash == previous.hash
    assert appended.height == previous.height + 1


def test_every_block_in_a_grown_chain_links_correctly(seeded_state: State) -> None:
    for index in range(4):
        append_block(seeded_state, [{"type": "TEST", "index": index}])
    blocks = seeded_state.blocks
    assert len(blocks) == 5
    assert all(blocks[i].prev_hash == blocks[i - 1].hash for i in range(1, len(blocks)))
    assert [block.height for block in blocks] == [0, 1, 2, 3, 4]


def test_appended_block_starts_unsigned_then_receives_the_quorum(seeded_state: State) -> None:
    """Signing happens AFTER the hash is finalised; the stored block must carry the quorum."""
    appended = append_block(seeded_state, [{"type": "TEST"}])
    assert appended.hash != ""
    assert set(appended.sigs.keys()) == set(AUTHORITY_IDS)


# --------------------------------------------------------------- quorum (FR-B5 / S3)


def test_every_seeded_block_carries_a_three_of_three_quorum(seeded_state: State) -> None:
    for block in seeded_state.blocks:
        assert set(block.sigs.keys()) == set(AUTHORITY_IDS)
        assert len(AUTHORITY_IDS) == 3


def test_each_signature_is_a_64_byte_ed25519_signature(seeded_state: State) -> None:
    """Ed25519 signatures are 64 bytes = 128 hex characters. A truncated or re-encoded
    signature would still be a non-empty string, so assert the length, not just presence."""
    for block in seeded_state.blocks:
        for signature in block.sigs.values():
            assert len(signature) == 128


def test_signatures_are_unique_per_block(seeded_state: State) -> None:
    """Different blocks have different hashes, so their signatures must differ — a constant
    signature would mean the key is not actually committing to the hash."""
    first = append_block(seeded_state, [{"type": "A"}])
    second = append_block(seeded_state, [{"type": "B"}])
    assert first.sigs != second.sigs


def test_verify_quorum_accepts_a_genuine_signature_set() -> None:
    block_hash = "f" * 64
    assert verify_quorum(block_hash, sign_block_hash(block_hash)) is True


def test_verify_quorum_rejects_a_signature_over_a_different_hash() -> None:
    """A signature that does not cover THIS hash must not pass."""
    sigs = sign_block_hash("a" * 64)
    assert verify_quorum("b" * 64, sigs) is False


def test_verify_quorum_rejects_a_two_of_three_set() -> None:
    """FR-B5 requires 3-of-3. Dropping one authority must fail, not degrade to majority."""
    block_hash = "c" * 64
    sigs = sign_block_hash(block_hash)
    del sigs[AUTHORITY_IDS[0]]
    assert verify_quorum(block_hash, sigs) is False


def test_verify_quorum_rejects_an_unknown_authority_id() -> None:
    """A rogue signer must not be able to stand in for a real authority."""
    block_hash = "d" * 64
    sigs = sign_block_hash(block_hash)
    sigs["node:rogue"] = sigs[AUTHORITY_IDS[0]]
    del sigs[AUTHORITY_IDS[0]]
    assert verify_quorum(block_hash, sigs) is False


@pytest.mark.parametrize("hostile", [None, 0, "not-a-mapping", [], ["a"], True])
def test_verify_quorum_never_raises_on_a_non_mapping_sigs(hostile: object) -> None:
    """A corrupt state file can put anything in `sigs`. It must yield False, never a 500 —
    a crash here would take the whole node down on a hostile file."""
    assert verify_quorum("e" * 64, hostile) is False  # type: ignore[arg-type]


def test_verify_signature_returns_false_for_garbage_rather_than_raising() -> None:
    """`verify_signature` must absorb malformed hex instead of letting a ValueError escape."""
    assert verify_signature("not-hex", "message", "also-not-hex") is False
    assert verify_signature("", "", "") is False


# --------------------------------------------------------------- chain verification (S2/S3)


def test_verify_chain_is_true_for_a_freshly_seeded_chain(seeded_state: State) -> None:
    assert verify_chain(seeded_state) is True
    assert _fault_code(seeded_state) is None


def test_verify_chain_survives_appended_blocks(seeded_state: State) -> None:
    for index in range(3):
        append_block(seeded_state, [{"type": "TEST", "index": index}])
    assert verify_chain(seeded_state) is True


def test_tampering_with_transactions_breaks_the_chain(seeded_state: State) -> None:
    """FR-B4: the stored hash no longer recomputes once the contents change."""
    append_block(seeded_state, [{"type": "REAL"}])
    seeded_state.blocks[1].txs = [{"type": "FORGED"}]
    assert verify_chain(seeded_state) is False
    assert _fault_code(seeded_state) == FAULT_BLOCK_HASH


def test_corrupting_a_single_signature_breaks_the_chain(seeded_state: State) -> None:
    """The quorum is load-bearing: a hash-valid block with a bad signature is still invalid."""
    append_block(seeded_state, [{"type": "REAL"}])
    victim = AUTHORITY_IDS[0]
    seeded_state.blocks[1].sigs[victim] = "0" * 128
    assert verify_chain(seeded_state) is False
    assert _fault_code(seeded_state) == FAULT_QUORUM_INVALID


def test_breaking_linkage_is_detected(seeded_state: State) -> None:
    append_block(seeded_state, [{"type": "REAL"}])
    seeded_state.blocks[1].prev_hash = "9" * 64
    assert verify_chain(seeded_state) is False


def test_forging_content_with_a_recomputed_hash_still_fails(seeded_state: State) -> None:
    """The strongest forgery: rewrite the txs AND recompute that block's own hash so the
    contents are self-consistent. Linkage alone would miss it — the quorum catches it,
    because the attacker cannot re-sign without the authority keys."""
    append_block(seeded_state, [{"type": "REAL"}])
    forged = seeded_state.blocks[1]
    forged.txs = [{"type": "FORGED"}]
    forged.hash = _hash(
        {"height": forged.height, "prev_hash": forged.prev_hash, "ts_ms": forged.ts_ms, "txs": forged.txs}
    )
    assert verify_chain(seeded_state) is False


# --------------------------------------------------------------- tamper events (S4)


def test_tamper_event_is_recorded_in_a_machine_readable_envelope(seeded_state: State) -> None:
    """S4's whole point: a consumer selects the event by `type`/`faultCode`, never by
    string-matching prose."""
    fault = server_main._chain_fault(seeded_state)
    assert fault is None
    append_block(seeded_state, [{"type": "REAL"}])
    seeded_state.blocks[1].txs = [{"type": "FORGED"}]
    detected = server_main._chain_fault(seeded_state)
    assert detected is not None

    _record_tamper_event(seeded_state, detected, "TEST_SOURCE")
    event = seeded_state.tamper_events[-1]
    assert event["type"] == "TAMPER_DETECTED"
    assert event["faultCode"] == FAULT_BLOCK_HASH
    assert event["height"] == 1
    assert event["source"] == "TEST_SOURCE"
    assert isinstance(event["atMs"], int)


def test_tamper_events_are_bounded(seeded_state: State) -> None:
    """A corrupt chain refuses EVERY write and each refusal appends an event, so without a
    bound the list grows without limit."""
    fault = server_main.ChainFault(code=FAULT_BLOCK_HASH, height=1, text="test")
    for _ in range(MAX_TAMPER_EVENTS + 25):
        _record_tamper_event(seeded_state, fault, "TEST")
    assert len(seeded_state.tamper_events) == MAX_TAMPER_EVENTS


def test_tamper_events_are_persisted(seeded_state: State) -> None:
    fault = server_main.ChainFault(code=FAULT_BLOCK_HASH, height=1, text="test")
    _record_tamper_event(seeded_state, fault, "TEST")
    assert len(load_state().tamper_events) >= 1


def test_tamper_event_is_recorded_in_memory_but_NOT_persisted_when_the_file_is_unreadable(
    data_dir: pathlib.Path,
) -> None:
    """The split is deliberate and worth pinning exactly.

    The event IS appended in memory — the detection is real, and the live SSE subscribers
    must still be told — but `save_state()` is skipped, because re-serialising the placeholder
    would overwrite the corrupt file and destroy the very evidence being reported.
    """
    server_main.STATE_PATH.write_text("{ not json", "utf-8")
    placeholder = load_state()
    assert placeholder.load_error is not None

    before = server_main.STATE_PATH.read_text("utf-8")
    _record_tamper_event(placeholder, server_main.ChainFault(code="X", height=None, text="t"), "TEST")

    assert len(placeholder.tamper_events) == 1                  # detection IS recorded in memory
    assert placeholder.tamper_events[0]["type"] == "TAMPER_DETECTED"
    assert server_main.STATE_PATH.read_text("utf-8") == before  # file deliberately untouched


# --------------------------------------------------------------- state file (S91)


def test_an_empty_document_is_a_re_seed_signal(data_dir: pathlib.Path) -> None:
    """`{}` means "seed me", which is how the probe forces a pristine run without deleting."""
    server_main.STATE_PATH.write_text("{}", "utf-8")
    state = load_state()
    assert state.load_error is None
    assert state.blocks == []


def test_an_unreadable_state_file_yields_a_bootable_placeholder(data_dir: pathlib.Path) -> None:
    """A malformed file must never brick the boot: the node comes up and REPORTS the fault."""
    server_main.STATE_PATH.write_text("{{{ not json", "utf-8")
    state = load_state()
    assert state.load_error is not None
    assert state.blocks == []


def test_an_unreadable_state_file_is_left_untouched_on_disk(data_dir: pathlib.Path) -> None:
    """Self-healing a corrupt file would erase the evidence of tampering."""
    server_main.STATE_PATH.write_text("{{{ not json", "utf-8")
    load_state()
    assert server_main.STATE_PATH.read_text("utf-8") == "{{{ not json"


def test_seeding_populates_every_table(seeded_state: State) -> None:
    """The seed is the fixture the API's absolute-balance assertions rest on."""
    assert seeded_state.wallets
    assert seeded_state.auctions
    assert seeded_state.approvals
    assert seeded_state.drones
    assert seeded_state.missions


def test_seeding_is_idempotent(seeded_state: State) -> None:
    """`seed_if_empty` must not re-seed an already-seeded state — a second genesis block
    would silently rewrite the chain's history."""
    height_before = len(seeded_state.blocks)
    wallets_before = json.dumps(seeded_state.wallets, sort_keys=True)
    seed_if_empty(seeded_state)
    assert len(seeded_state.blocks) == height_before
    assert json.dumps(seeded_state.wallets, sort_keys=True) == wallets_before


def test_seeding_never_touches_a_state_carrying_a_load_error(data_dir: pathlib.Path) -> None:
    """Seeding over an unreadable file would overwrite the tamper evidence."""
    server_main.STATE_PATH.write_text("{{{ not json", "utf-8")
    placeholder = load_state()
    seed_if_empty(placeholder)
    assert placeholder.blocks == []
    assert placeholder.wallets == {}


def test_save_state_leaves_no_temporary_file_behind(seeded_state: State) -> None:
    """`save_state` writes a `.json.tmp` then `os.replace`s it — the atomic-swap trick that
    makes a crash mid-write survivable. A leftover `.tmp` would mean the swap never ran."""
    save_state(seeded_state)
    leftovers = list(server_main.STATE_PATH.parent.glob("*.tmp"))
    assert leftovers == []


def test_state_survives_a_save_and_reload_round_trip(seeded_state: State) -> None:
    append_block(seeded_state, [{"type": "ROUND_TRIP"}])
    save_state(seeded_state)
    reloaded = load_state()
    assert len(reloaded.blocks) == len(seeded_state.blocks)
    assert reloaded.blocks[-1].txs == [{"type": "ROUND_TRIP"}]
    assert verify_chain(reloaded) is True


def test_load_error_is_never_serialised_back_to_disk(seeded_state: State) -> None:
    """`load_error` is declared `exclude=True`; persisting it would make a transient read
    failure look permanent after the file is repaired."""
    save_state(seeded_state)
    on_disk = json.loads(server_main.STATE_PATH.read_text("utf-8"))
    assert "load_error" not in on_disk


def test_block_model_round_trips_through_json(seeded_state: State) -> None:
    block = seeded_state.blocks[0]
    assert Block.model_validate(json.loads(block.model_dump_json())).model_dump() == block.model_dump()
