"""BUSTARON M3 backend — FastAPI server behind the frontend's DataBackend seam.

Serves the PRD §4.4 `server` role on port 8000:
  GET  /api/health              liveness + chain stats + tamper state (PRD S4)
  GET  /api/zones               RFZ pack (same ingested CAD data the frontend uses)
  GET  /api/fleet               drone roster
  GET  /api/missions            mission list
  GET  /chain                   full PoA chain (3-of-3 signed, append-only, hash-chained)
  GET  /block/{height}          single block by height
  GET  /events                  durable ledger events as a live SSE stream (PRD S6)
  POST /chain/tx               submit a transaction (auction bid, approval decision, …)
  GET  /api/auctions            open + decided auctions (server-persisted)
  GET  /api/approvals           approval queue (server-persisted)
  GET  /api/wallets             credit wallets (server-persisted)

Persistence: JSON state file (data_dir/state.json) written atomically after
every mutation — survives restarts, no external database required this
increment. The ledger is append-only and hash-chained (PRD FR-B4): each block
stores prev_hash; any tampering breaks the chain on the next verification.
Consensus is 3-of-3 Proof of Authority (PRD §9, FR-B5): every block is
co-signed by all three authorities in server/authorities.py, and a block is only
anchored — and only accepted on read — when that quorum verifies.

Tamper handling (PRD S4 + FR-B6). Any chain fault is reported through a single
detection point, `_chain_fault()`, which yields a `ChainFault` — a machine-readable
`code` + offending `height` beside the human prose. A corrupt state file is REPORTED,
never re-seeded; `POST /chain/tx` refuses to extend an invalid chain with 409 and
records a durable event in `State.tamper_events`. `/api/health` exposes `chainValid` /
`tamperDetected` / `chainFault` / `chainFaultCode` / `tamperEventCount`.

Event delivery (PRD S6, FR-B8). Every durable event is emitted as a machine-readable
envelope carrying an explicit `type` (`TAMPER_DETECTED`, PRD §9.3) and a stable
`faultCode`, so a client never has to string-match prose. `GET /events` serves that
log as a Server-Sent Events stream: it REPLAYS the durable history on connect and then
pushes new events live, so a tamper recorded during an append cycle reaches a connected
client within that cycle. `EventBroker` does the fan-out thread-safely, because the
producer (`submit_tx`) is a sync `def` that FastAPI runs in a threadpool.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from server.authorities import sign_block_hash, verify_quorum

app = FastAPI(title="BUSTARON M3 server", version="0.1.0")

# The frontend dev/preview origins hit the API cross-origin (5173/4173).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


#: Machine-readable fault codes. A client branches on these; `ChainFault.text` is prose
#: for humans and must never be matched on. Stable identifiers, so they are constants
#: rather than inline literals.
FAULT_STATE_UNREADABLE = "STATE_FILE_UNREADABLE"
FAULT_BLOCK_LINK = "BLOCK_LINK_BROKEN"
FAULT_BLOCK_HASH = "BLOCK_HASH_MISMATCH"
FAULT_QUORUM_INVALID = "QUORUM_INVALID"
FAULT_UNKNOWN = "UNKNOWN_FAULT"

#: Legacy prose fragment -> fault code. Used to backfill records written BEFORE events
#: carried a `faultCode` (see `_event_envelope`), so old evidence is still readable by
#: a machine. Matching is on a stable substring of the prose `_chain_fault` emits.
_LEGACY_FAULT_CODES: tuple[tuple[str, str], ...] = (
    ("does not link to its predecessor", FAULT_BLOCK_LINK),
    ("hash does not match its contents", FAULT_BLOCK_HASH),
    ("lacks a valid 3-of-3 authority quorum", FAULT_QUORUM_INVALID),
    ("state file is unreadable or corrupt", FAULT_STATE_UNREADABLE),
)


@dataclass(frozen=True)
class ChainFault:
    """A detected integrity fault in machine-readable form.

    * `code` — the stable token a client branches on (see the `FAULT_*` constants);
    * `height` — the offending block height, or None when the fault cannot be attributed
      to a block at all (an unreadable/corrupt state file);
    * `text` — the human prose, preserved verbatim so the existing `/api/health`
      `chainFault` contract and the `TAMPER_DETECTED` log lines are unchanged.
    """

    code: str
    height: int | None
    text: str


class ChainIntegrityError(HTTPException):
    """HTTP 409 raised when a write is refused because the chain is not trustworthy.

    A *detected* integrity condition is a conflict with the server's current — corrupt —
    state, NOT a server bug, so it is 409 rather than 5xx (see `submit_tx`, FR-B6).
    Carries the whole `ChainFault` so the handler can echo both the prose and the
    machine-readable code in the body.
    """

    def __init__(self, fault: ChainFault) -> None:
        super().__init__(status_code=409, detail=f"Refusing to append to an invalid chain: {fault.text}")
        self.fault = fault.text
        self.fault_code = fault.code
        self.fault_height = fault.height


@app.exception_handler(ChainIntegrityError)
async def _chain_integrity_handler(_request: Request, exc: ChainIntegrityError) -> JSONResponse:
    """Serialises `ChainIntegrityError` with a top-level, machine-readable `tamperDetected`.

    FastAPI's default handler only emits `{"detail": ...}`; tamper clients need a boolean
    they can branch on without string-matching the detail, so we flatten it here — along
    with `chainFaultCode` / `chainFaultHeight`, which name the fault without prose. This
    handler is registered for the SUBCLASS only, so every other HTTPException keeps its
    default shape.
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": exc.detail,
            "tamperDetected": True,
            "chainFault": exc.fault,
            "chainFaultCode": exc.fault_code,
            "chainFaultHeight": exc.fault_height,
        },
    )


DATA_DIR = Path(os.environ.get("BUSTARON_DATA_DIR", Path(__file__).resolve().parent / "data"))
STATE_PATH = DATA_DIR / "state.json"
STATE_LOCK = threading.Lock()

logger = logging.getLogger("bustaron.server")

#: State schema version, written into state.json so a future format change is
#: detectable instead of being mis-parsed.
#:   1 — pre-signature blocks (no `sigs`): the shape M3 phase 1 shipped.
#:   2 — every block carries a 3-of-3 authority `sigs` quorum (PRD §9.2, FR-B5).
CURRENT_SCHEMA_VERSION = 2

# Types accepted by POST /chain/tx. Every entry here MUST have a dispatch branch
# in submit_tx(); advertising a type the handler rejects produces a confusing
# "400 Unsupported tx type" for an input the API schema said was valid.
# AUCTION_SETTLE and APPROVAL_FILE were once declared here without a handler; they
# are now genuinely implemented (apply_settle / apply_file_approval) and so are
# re-advertised. GENESIS stays out of this union: it is minted by seed_if_empty()
# at first boot to anchor the chain, never submitted by a client.
TXType = Literal[
    "AUCTION_BID",
    "AUCTION_AWARD",
    "APPROVAL_DECIDE",
    "AUCTION_SETTLE",
    "APPROVAL_FILE",
]

# Types that exist in the domain but are deliberately NOT client-submittable.
# Kept as a documented allowlist so the omission is deliberate and greppable,
# not accidental. GENESIS is the only member: seed_if_empty() appends it once at
# first boot, and no client may submit it.
UNIMPLEMENTED_TX_TYPES = ("GENESIS",)


def _hash(payload: dict[str, Any]) -> str:
    """SHA-256 over the canonical JSON of a block's signed fields.

    The payload is exactly ``{height, prev_hash, ts_ms, txs}``. ``sigs`` and
    ``proposer`` are DELIBERATELY excluded: the authority signatures in ``sigs``
    are computed OVER this hash, so folding ``sigs`` back in would create a
    hash/signature cycle (the hash would depend on the signatures that in turn
    depend on the hash). ``proposer`` is metadata about who assembled the block,
    not part of the payload the authorities agree on. Do not add either field
    here — `sign_block_hash()` and `verify_quorum()` in server/authorities.py
    rely on this exact exclusion.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _now_ms() -> int:
    return int(time.time() * 1000)


class Block(BaseModel):
    height: int
    prev_hash: str
    ts_ms: int
    txs: list[dict[str, Any]]
    proposer: str = "node:admin"
    hash: str
    # 3-of-3 Proof-of-Authority quorum over `hash`, keyed by authority id
    # (PRD §9.2 shape). Populated by append_block() AFTER `hash` is final; `hash`
    # itself excludes `sigs` so there is no hash/signature cycle (see _hash).
    sigs: dict[str, str] = {}


class State(BaseModel):
    schema_version: int = CURRENT_SCHEMA_VERSION
    # Non-None only on an in-memory placeholder for a state file that could not be
    # read/validated. `exclude=True` keeps it out of every serialisation, so it can
    # never be persisted back to disk.
    load_error: str | None = Field(default=None, exclude=True)
    blocks: list[Block] = []
    wallets: dict[str, dict[str, Any]] = {}
    auctions: dict[str, dict[str, Any]] = {}
    approvals: dict[str, dict[str, Any]] = {}
    credit_ledger: list[dict[str, Any]] = []
    drones: list[dict[str, Any]] = []
    missions: list[dict[str, Any]] = []
    #: Durable audit trail of REFUSED writes (PRD S4 / FR-B6). A detected tamper cannot
    #: be recorded as a block — that would append to the very chain we just declared
    #: untrustworthy — so refusals land here instead, and (unlike `load_error`) this
    #: field IS persisted, so the trail survives a restart.
    tamper_events: list[dict[str, Any]] = []


def _invalid_state(reason: str) -> State:
    """A bootable placeholder for a state file that is unreadable or corrupt.

    A malformed `state.json` must NOT brick the service: `seed_if_empty(load_state())`
    runs at import, so letting `json`/Pydantic raise there would stop the server from
    ever binding. Instead we return an EMPTY state flagged with `load_error`, so the
    process comes up and reports `chainValid: false` (PRD S4) rather than dying. The
    file itself is left untouched — re-seeding a corrupt v2 file would self-heal it and
    erase the evidence of tampering (only a genuine v1 legacy file is re-seeded).
    """
    logger.error(
        "TAMPER_DETECTED — state.json is unreadable or corrupt (%s); block height unknown. "
        "Reporting the chain invalid and leaving the file untouched (not re-seeded).",
        reason,
    )
    return State(load_error=reason)


def load_state() -> State:
    """Loads state.json, surviving a corrupt file and migrating a pre-signature one.

    Three outcomes:

    * **missing / blank file** -> a fresh `State()` (which `seed_if_empty` then seeds);
    * **genuine v1 legacy** (`schema_version < 2`) -> re-seeded, with a WARNING. A v1
      file has blocks with no `sigs`, which can never satisfy the 3-of-3 quorum, so
      `verify_chain()` would report it invalid forever. We re-seed rather than re-sign
      those blocks — minting signatures for blocks no authority ever approved would
      FABRICATE provenance. Re-seeding is lossless: `state.json` is untracked dev data
      that `seed_if_empty()` rebuilds deterministically;
    * **unreadable or corrupt v2** -> `_invalid_state()`, i.e. bootable + reported
      invalid + the file left alone. Never re-seeded (self-healing hides tampering).
    """
    if not STATE_PATH.exists():
        return State()
    try:
        raw = json.loads(STATE_PATH.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return _invalid_state(f"not readable as JSON: {exc}")
    if not isinstance(raw, dict):
        return _invalid_state(f"expected a JSON object, found {type(raw).__name__}")

    # A file predating this field is by definition pre-signature (version 1).
    stored_version = raw.get("schema_version", 1)
    if not isinstance(stored_version, int):
        return _invalid_state(f"schema_version must be an integer, found {stored_version!r}")
    if stored_version < CURRENT_SCHEMA_VERSION:
        # Only warn when there is actually legacy CONTENT to abandon. A blank or
        # freshly-created file (e.g. the probe's deliberate `{}` re-seed signal) has
        # nothing to migrate, so re-seeding it silently is correct and avoids a
        # misleading warning on every clean boot. Any OTHER non-empty field in a
        # pre-signature document — blocks, wallets, auctions, approvals, … — is thrown
        # away by the re-seed, so it must be NAMED in the warning rather than dropped
        # silently (a legacy file with wallets but no blocks is still data loss).
        discarded = sorted(key for key, value in raw.items() if key != "schema_version" and value)
        if discarded:
            logger.warning(
                "state.json schema_version=%s predates signature support (current=%s): "
                "re-seeding a fresh, fully-signed chain. Discarded legacy content: %s. "
                "Legacy blocks are NOT re-signed.",
                stored_version,
                CURRENT_SCHEMA_VERSION,
                ", ".join(discarded),
            )
        return State()

    try:
        return State.model_validate(raw)
    except ValidationError as exc:
        # A v2 document that does not match the schema is corrupt or tampered with. Boot
        # anyway and report it — do NOT re-seed (that would hide the tampering).
        return _invalid_state(f"failed schema validation with {exc.error_count()} error(s)")


def save_state(state: State) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    tmp.write_text(state.model_dump_json(indent=1), "utf-8")
    os.replace(tmp, STATE_PATH)


def append_block(state: State, txs: list[dict[str, Any]], proposer: str = "node:admin") -> Block:
    prev_hash = state.blocks[-1].hash if state.blocks else "0" * 64
    block = Block(
        height=len(state.blocks),
        prev_hash=prev_hash,
        ts_ms=_now_ms(),
        txs=txs,
        proposer=proposer,
        hash="",
    )
    block.hash = _hash({"height": block.height, "prev_hash": block.prev_hash, "ts_ms": block.ts_ms, "txs": block.txs})
    # Collect the 3-of-3 Proof-of-Authority quorum over the finalised hash
    # (PRD §9, FR-B5). Signing happens AFTER `hash` is set, which is exactly why
    # `_hash` must exclude `sigs`: the signatures commit to the hash, not vice
    # versa. Genesis is minted through this same path, so it is signed too.
    block.sigs = sign_block_hash(block.hash)
    state.blocks.append(block)
    return block


def _report(fault: ChainFault) -> ChainFault:
    """Logs a detected chain fault with the PRD S4 token and returns it to the caller."""
    logger.error("TAMPER_DETECTED — %s", fault.text)
    return fault


def _chain_fault(state: State) -> ChainFault | None:
    """Description of the FIRST fault in the chain, or None when the chain is valid.

    Three independent checks per block (PRD FR-B4 + FR-B5), in order: linkage, integrity
    (the stored `hash` recomputes) and consensus (`verify_quorum` over that hash).

    This is the single detection-and-report point for PRD S4: every fault is logged with
    the literal token `TAMPER_DETECTED` and returned as a `ChainFault`, so no caller can
    observe an invalid chain silently and none has to parse prose to learn WHAT broke —
    `code` names the failure and `height` names the block. A `load_error` placeholder
    (unreadable/corrupt file) is reported too — it was already logged by
    `_invalid_state()` when read.
    """
    if state.load_error is not None:
        return _report(
            ChainFault(
                FAULT_STATE_UNREADABLE,
                None,
                f"state file is unreadable or corrupt: {state.load_error}",
            )
        )
    prev = "0" * 64
    for block in state.blocks:
        recomputed = _hash(
            {"height": block.height, "prev_hash": block.prev_hash, "ts_ms": block.ts_ms, "txs": block.txs}
        )
        if block.prev_hash != prev:
            return _report(
                ChainFault(FAULT_BLOCK_LINK, block.height, f"block {block.height} does not link to its predecessor")
            )
        if block.hash != recomputed:
            return _report(
                ChainFault(FAULT_BLOCK_HASH, block.height, f"block {block.height} hash does not match its contents")
            )
        if not verify_quorum(block.hash, block.sigs):
            return _report(
                ChainFault(
                    FAULT_QUORUM_INVALID,
                    block.height,
                    f"block {block.height} lacks a valid 3-of-3 authority quorum",
                )
            )
        prev = block.hash
    return None


def verify_chain(state: State) -> bool:
    """True iff every block is correctly linked, hash-intact AND 3-of-3 signed.

    Any failure anywhere invalidates the whole chain; the specific fault (and the block
    height that caused it) is logged as `TAMPER_DETECTED` by `_chain_fault`.
    """
    return _chain_fault(state) is None


#: Hard cap on the durable tamper-event audit log. A corrupt chain refuses EVERY write
#: and each refusal appends one event, so without a bound the list grows without limit.
MAX_TAMPER_EVENTS = 100

#: The one event type a durable record can carry today (PRD §9.3). Named as a constant
#: because clients select on this token rather than on the prose `fault` field.
EVENT_TAMPER_DETECTED = "TAMPER_DETECTED"

#: Heartbeat cadence for `GET /events`. A comment frame this often keeps idle proxies
#: from reaping the connection and lets a vanished client be noticed promptly.
EVENT_HEARTBEAT_S = 15.0

#: How often an idle stream re-checks whether its client is still connected. Decoupled
#: from `EVENT_HEARTBEAT_S` on purpose: a blocked queue read cannot notice a disconnect,
#: so this bounds how long a client that has gone away can hold a queue. Keep-alive
#: traffic stays at the slower heartbeat cadence.
EVENT_POLL_S = 1.0

#: Per-subscriber backlog for `GET /events`. A client that stops reading must never stall
#: the producer — which is a synchronous request thread — so a full queue sheds its OLDEST
#: entry instead of blocking. Nothing is lost durably: a reconnecting client replays the
#: whole durable log again.
MAX_QUEUED_EVENTS = 256

#: SSE comment frame emitted once, immediately after the replay, to mark the end of history.
#: A line beginning with ':' is ignored by every SSE client by spec, so this is invisible to
#: consumers; it exists because a client cannot otherwise distinguish "history is finished"
#: from "history is still arriving", and therefore cannot distinguish a replayed event from a
#: live one either. Detection tests key their live boundary on this marker.
REPLAY_COMPLETE_MARKER = "replay-complete"


class EventBroker:
    """Fan-out of ledger events to live `GET /events` subscribers.

    Producers call `publish()` from a WORKER THREAD: `submit_tx` is a sync `def`, so
    FastAPI runs it in a threadpool, while subscribers are `asyncio.Queue`s owned by the
    server's event loop. `asyncio.Queue` is NOT thread-safe, so the handoff goes through
    `loop.call_soon_threadsafe()` — a bare `put_nowait()` from the producer thread would
    corrupt the queue.

    `publish()` is a deliberate no-op when no loop is bound or the loop is closed:
    `_record_tamper_event` also runs at import time (state loading, before uvicorn starts
    a loop) and publishing there must never raise. A dropped live event is not lost — it
    is durable in `state.tamper_events`, and every new subscriber replays that log first.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        """Registers a subscriber. Must be called from the event-loop thread."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=MAX_QUEUED_EVENTS)
        with self._lock:
            self._subscribers.add(queue)
            with contextlib.suppress(RuntimeError):
                # Not on a loop (should not happen for an endpoint): publish stays a no-op.
                self._loop = asyncio.get_running_loop()
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Drops a subscriber. Called from the stream generator's `finally`."""
        with self._lock:
            self._subscribers.discard(queue)

    def subscriber_count(self) -> int:
        """Live `GET /events` subscriber count — observability, and the leak check."""
        with self._lock:
            return len(self._subscribers)

    def publish(self, event: dict[str, Any]) -> None:
        """Publishes to every current subscriber. Thread-safe and never raises."""
        with self._lock:
            loop = self._loop
            subscribers = list(self._subscribers)
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._fanout, event, subscribers)
        except RuntimeError:
            # The loop closed between the check above and the handoff.
            return

    def _fanout(self, event: dict[str, Any], subscribers: list[asyncio.Queue[dict[str, Any]]]) -> None:
        """Runs ON THE LOOP. Never blocks: a full queue sheds its oldest entry."""
        for queue in subscribers:
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):  # full implies non-empty
                    queue.get_nowait()
            queue.put_nowait(event)


EVENT_BROKER = EventBroker()


def _fault_code_from_text(text: str) -> str:
    """Backfills a machine-readable code for a record written before events carried one."""
    for needle, code in _LEGACY_FAULT_CODES:
        if needle in text:
            return code
    return FAULT_UNKNOWN


def _height_from_text(text: str) -> int | None:
    """Backfills the offending block height from legacy prose (`block 3 …`), if named."""
    match = re.search(r"\bblock (\d+)\b", text)
    return int(match.group(1)) if match else None


def _event_envelope(raw: dict[str, Any], ordinal: int | None = None) -> dict[str, Any]:
    """Normalises a durable event record into the machine-readable event envelope.

    The shape a client sees (PRD §9.3 lists `TAMPER_DETECTED` as a transaction type)::

        {"id": <unique>, "type": "TAMPER_DETECTED", "atMs": <int>, "source": <tx type>,
         "faultCode": <stable token>, "height": <block height | null>, "fault": <prose>}

    `type` and `faultCode` are the fields a client branches on. `fault` is prose and is
    never meant to be matched on — that is the whole point of this envelope.

    Normalisation happens ON READ, deliberately: a record persisted in the pre-B3 shape
    (``{"atMs", "source", "fault"}`` — no `type`, no code, no height) is upgraded on the
    fly, so the evidence file is never rewritten just to be readable and old records stay
    usable. The `id` is unique and is the deduplication key for the replay/live handoff in
    `events()`: a record written by this server carries a uuid, and a pre-B3 record — which
    was never assigned one — gets a POSITION-derived `legacy-{atMs}-{code}-{ordinal}`.
    Position is what makes it unique: a content-derived id collides for two legacy records
    in the same millisecond with the same code. `ordinal` is the record's index in the
    durable log; the replay loop always supplies it.
    """
    text = str(raw.get("fault", ""))
    code = raw.get("faultCode") or _fault_code_from_text(text)
    height = raw.get("height")
    if height is None:
        height = _height_from_text(text)
    at_ms = raw.get("atMs")
    return {
        "id": raw.get("id") or f"legacy-{at_ms}-{code}-{ordinal}",
        "type": raw.get("type") or EVENT_TAMPER_DETECTED,
        "atMs": at_ms,
        "source": raw.get("source"),
        "faultCode": code,
        "height": height,
        "fault": text,
    }


def _record_tamper_event(state: State, fault: ChainFault, source: str) -> None:
    """Appends a DURABLE `TAMPER_DETECTED` audit entry to `state.tamper_events`.

    Called when a write is refused (FR-B6). The event cannot be a block — appending a
    block to the chain we just declared corrupt would be self-contradictory — so it is
    recorded beside the chain and persisted with the rest of the state.

    The entry is written in the machine-readable envelope shape (explicit `type` + stable
    `faultCode` + offending `height`), NOT as prose, so a consumer selects the event
    without string-matching. Records predating this shape are upgraded on read by
    `_event_envelope`.

    When the state file itself could not be parsed (`load_error` set) we log only and do
    NOT write: re-serialising the placeholder would overwrite the corrupt file and destroy
    the very evidence of tampering we are reporting. The event is still PUBLISHED to live
    subscribers in that case — the detection is real even when it cannot be persisted.
    """
    event = {
        "id": uuid.uuid4().hex,
        "type": EVENT_TAMPER_DETECTED,
        "atMs": _now_ms(),
        "source": source,
        "faultCode": fault.code,
        "height": fault.height,
        "fault": fault.text,
    }
    state.tamper_events.append(event)
    del state.tamper_events[:-MAX_TAMPER_EVENTS]  # keep only the most recent 100 (spam-growth guard)
    if state.load_error is None:
        save_state(state)
    else:
        logger.error(
            "TAMPER_DETECTED — %s (source=%s); tamper event NOT persisted: the state file is "
            "unreadable, so writing would erase the evidence.",
            fault.text,
            source,
        )
    # Published AFTER the durable write, so a live subscriber never observes an event that
    # is not (yet) on disk. Safe from this thread; a no-op outside a running loop.
    EVENT_BROKER.publish(_event_envelope(event))


def wallet_of(state: State, wallet_id: str) -> dict[str, Any]:
    wallet = state.wallets.get(wallet_id)
    if wallet is None:
        raise HTTPException(status_code=404, detail=f"Unknown wallet: {wallet_id}")
    return wallet


# ---------------------------------------------------------------- seed state
def _wallet(wallet_id: str, operator: str, balance: int, reserved: int) -> dict[str, Any]:
    """Builds a seed wallet. Keeps the seed table readable within the line limit."""
    return {"id": wallet_id, "operatorName": operator, "balanceCredits": balance, "reservedCredits": reserved}


def _bid(bid_id: str, wallet_id: str, bidder: str, credits: int, submitted: str) -> dict[str, Any]:
    """Builds a seed auction bid."""
    return {"id": bid_id, "walletId": wallet_id, "bidder": bidder, "credits": credits, "submittedIso": submitted}


def _now_iso() -> str:
    """UTC timestamp in the ISO shape the ledger and bids use."""
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def _ledger(entry_id: str, wallet_id: str, delta: int, reason: str) -> dict[str, Any]:
    """Builds a credit-ledger row. Every ledger entry has this exact shape."""
    return {
        "id": entry_id,
        "walletId": wallet_id,
        "deltaCredits": delta,
        "reason": reason,
        "atIso": _now_iso(),
    }


SEED_WALLETS = {
    "wallet-harbour": _wallet("wallet-harbour", "Harbour Ops Desk", 480, 40),
    "wallet-urban": _wallet("wallet-urban", "Urban Scan Team", 260, 80),
    "wallet-cargo": _wallet("wallet-cargo", "Cargo Pilot Cell", 640, 160),
}

SEED_AUCTIONS = {
    "auction-vh-morning": {
        "id": "auction-vh-morning",
        "slotName": "Victoria Harbour corridor · morning window",
        "corridorZoneId": "zone-harbour-corridor",
        "windowStartIso": "2026-09-25T01:00:00.000Z",
        "windowEndIso": "2026-09-25T04:00:00.000Z",
        "reserveCredits": 30,
        "status": "open",
        "bids": [
            _bid("bid-harbour-1", "wallet-harbour", "Harbour Ops Desk", 40, "2026-09-24T12:40:00.000Z"),
            _bid("bid-cargo-1", "wallet-cargo", "Cargo Pilot Cell", 120, "2026-09-24T12:46:00.000Z"),
        ],
        "winningBidId": None,
    },
    "auction-cbd-evening": {
        "id": "auction-cbd-evening",
        "slotName": "Central district façade slot · evening window",
        "corridorZoneId": "zone-govt-hq",
        "windowStartIso": "2026-09-25T10:00:00.000Z",
        "windowEndIso": "2026-09-25T12:00:00.000Z",
        "reserveCredits": 50,
        "status": "open",
        "bids": [
            _bid("bid-urban-1", "wallet-urban", "Urban Scan Team", 65, "2026-09-24T12:51:00.000Z"),
        ],
        "winningBidId": None,
    },
}

SEED_APPROVALS = {
    "approval-kt-19": {
        "id": "approval-kt-19",
        "missionName": "Kowloon East logistics corridor",
        "operator": "Cargo Pilot Cell",
        "walletId": "wallet-cargo",
        "requestedAtIso": "2026-09-24T12:30:00.000Z",
        "status": "pending",
        "riskLevel": "low",
        "creditsEscrowed": 40,
        "reason": "Scheduled resupply run inside approved corridor altitude band.",
        "decisionReason": None,
    },
    "approval-cbd-04": {
        "id": "approval-cbd-04",
        "missionName": "Central district façade survey",
        "operator": "Urban Scan Team",
        "walletId": "wallet-urban",
        "requestedAtIso": "2026-09-24T12:55:00.000Z",
        "status": "pending",
        "riskLevel": "high",
        "creditsEscrowed": 80,
        "reason": "Facade survey adjacent to the Central Government Complex RFZ.",
        "decisionReason": None,
    },
}


def _drone(
    drone_id: str,
    callsign: str,
    operator_id: str,
    lat: float,
    lng: float,
    altitude_m: int,
    status: str,
    battery_pct: int,
    mission_id: str,
    heading_deg: int,
    speed_kph: int,
    last_seen_iso: str,
) -> dict[str, Any]:
    """Builds a seed drone row matching the frontend `Drone` shape (PRD S114)."""
    return {
        "id": drone_id,
        "callsign": callsign,
        "operatorId": operator_id,
        "position": {"lat": lat, "lng": lng},
        "altitudeM": altitude_m,
        "status": status,
        "batteryPct": battery_pct,
        "missionId": mission_id,
        "headingDeg": heading_deg,
        "speedKph": speed_kph,
        "lastSeenIso": last_seen_iso,
    }


def _mission(
    mission_id: str,
    name: str,
    operator: str,
    route: list[dict[str, float]],
    status: str,
    risk_level: str,
    altitude_window_m: list[int],
    eta_iso: str,
) -> dict[str, Any]:
    """Builds a seed mission row matching the frontend `Mission` shape (PRD S112)."""
    return {
        "id": mission_id,
        "name": name,
        "operator": operator,
        "route": route,
        "status": status,
        "riskLevel": risk_level,
        "altitudeWindowM": altitude_window_m,
        "etaIso": eta_iso,
    }


#: Seeded drone roster. The north star (item 5) requires `/api/fleet` to return
#: real rows rather than an empty array beside a populated mock UI, so the seed
#: mirrors the frontend's own fleet — same ids, operator ids and callsigns — and
#: is written into `State.drones` by `seed_if_empty()`.
SEED_DRONES = [
    _drone("drone-hk-01", "BSN-01", "wallet-harbour", 22.303, 114.171, 118, "nominal", 82, "mission-vh-12", 82, 42, "2026-09-24T13:35:00.000Z"),
    _drone("drone-hk-02", "BSN-07", "wallet-urban", 22.281, 114.158, 92, "warning", 35, "mission-cbd-04", 248, 34, "2026-09-24T13:34:40.000Z"),
    _drone("drone-hk-03", "BSN-11", "wallet-cargo", 22.337, 114.201, 142, "nominal", 68, "mission-kt-19", 32, 39, "2026-09-24T13:34:55.000Z"),
    _drone("drone-hk-04", "BSN-15", "wallet-harbour", 22.318, 114.134, 0, "grounded", 91, "mission-standby", 0, 0, "2026-09-24T13:30:00.000Z"),
]

#: Seeded mission list. Mirrors the frontend mock missions so `/api/missions`
#: returns the same plans the operator console renders.
SEED_MISSIONS = [
    _mission(
        "mission-vh-12",
        "Victoria Harbour inspection",
        "Harbour Ops Desk",
        [{"lat": 22.299, "lng": 114.145}, {"lat": 22.303, "lng": 114.171}, {"lat": 22.309, "lng": 114.197}],
        "active",
        "medium",
        [90, 130],
        "2026-09-24T14:05:00.000Z",
    ),
    _mission(
        "mission-cbd-04",
        "Central district façade survey",
        "Urban Scan Team",
        [{"lat": 22.274, "lng": 114.139}, {"lat": 22.281, "lng": 114.158}, {"lat": 22.287, "lng": 114.176}],
        "paused",
        "high",
        [70, 110],
        "2026-09-24T14:22:00.000Z",
    ),
    _mission(
        "mission-kt-19",
        "Kowloon East logistics corridor",
        "Cargo Pilot Cell",
        [{"lat": 22.319, "lng": 114.178}, {"lat": 22.337, "lng": 114.201}, {"lat": 22.356, "lng": 114.217}],
        "active",
        "low",
        [120, 160],
        "2026-09-24T13:58:00.000Z",
    ),
]


def seed_if_empty(state: State) -> None:
    # Never seed over a file we could not read: that would overwrite the evidence of
    # tampering (self-healing hides an attack). A genuinely blank or missing file has
    # `load_error is None`, so it still seeds. Idempotence is unchanged: the guard is
    # still `not blocks and not wallets`, and the drone/mission tables are seeded
    # inside the same single block, so an already-seeded file is never re-seeded.
    if state.load_error is None and not state.blocks and not state.wallets:
        state.wallets = SEED_WALLETS
        state.auctions = SEED_AUCTIONS
        state.approvals = SEED_APPROVALS
        state.drones = SEED_DRONES
        state.missions = SEED_MISSIONS
        append_block(state, [{"type": "GENESIS", "note": "BUSTARON M3 chain seeded"}])
        save_state(state)


seed_if_empty(load_state())


# ---------------------------------------------------------------------- models
class Tx(BaseModel):
    type: TXType
    payload: dict[str, Any] = Field(default_factory=dict)


class BidPayload(BaseModel):
    auctionId: str
    walletId: str
    credits: int


class AwardPayload(BaseModel):
    auctionId: str


class ApprovalPayload(BaseModel):
    approvalId: str
    decision: Literal["approved", "rejected"]
    reason: str | None = None


class SettlePayload(BaseModel):
    auctionId: str
    ownerWalletId: str


class FileApprovalPayload(BaseModel):
    id: str
    missionName: str
    operator: str
    walletId: str
    creditsEscrowed: int
    riskLevel: str = "low"
    reason: str = ""
    requestedAtIso: str = Field(default_factory=_now_iso)


# --------------------------------------------------------------------- routes
@app.get("/api/health")
def health() -> dict[str, Any]:
    """Liveness + chain stats. `status` is LIVENESS ONLY — a tampered chain still serves,
    so pollers must read `chainValid` / `tamperDetected`, not `status`. PRD S4: the chain's
    tamper state is exposed here; `GET /events` additionally STREAMS it.
    """
    state = load_state()
    fault = _chain_fault(state)  # logs TAMPER_DETECTED on the first fault
    return {
        "status": "ok",
        "chainHeight": len(state.blocks),
        "chainValid": fault is None,
        "tamperDetected": fault is not None,
        "chainFault": fault.text if fault is not None else None,
        # Machine-readable companion to `chainFault`: a poller branches on the code
        # instead of string-matching the prose. None when the chain is valid.
        "chainFaultCode": fault.code if fault is not None else None,
        "chainFaultHeight": fault.height if fault is not None else None,
        # Durable count of REFUSED writes (FR-B6) — a non-zero count with a now-valid
        # chain still means someone tried to extend a corrupt chain at some point.
        "tamperEventCount": len(state.tamper_events),
        # Live `GET /events` subscribers. Must fall back to 0 as clients disconnect —
        # a count that only climbs means a stream leaked its queue.
        "eventSubscribers": EVENT_BROKER.subscriber_count(),
        "auctions": len(state.auctions),
        "approvals": len(state.approvals),
        "wallets": len(state.wallets),
    }


@app.get("/chain")
def chain() -> dict[str, Any]:
    state = load_state()
    return {
        "height": len(state.blocks),
        "valid": verify_chain(state),
        "blocks": [block.model_dump() for block in state.blocks],
    }


@app.get("/block/{height}")
def block_by_height(height: int) -> dict[str, Any]:
    state = load_state()
    if height < 0 or height >= len(state.blocks):
        raise HTTPException(status_code=404, detail=f"No block at height {height}")
    return state.blocks[height].model_dump()


def _sse_frame(event: dict[str, Any]) -> str:
    """Serialises one event as a Server-Sent Events frame.

    An `id:` field carries the event's `id`, which is what an SSE client echoes back in
    `Last-Event-ID` when it reconnects (see `events()`). Note the stream is AT-LEAST-ONCE:
    resume is best-effort, so a client must tolerate seeing the same `id` twice and must
    deduplicate on `id` rather than assume it has seen each event exactly once.

    Only a `data:` field is emitted beyond that, deliberately — the machine-readable `type`
    travels INSIDE the JSON payload rather than in an SSE `event:` field, for two reasons:

    * an `event:` name suppresses the default "message" event, so a client using the most
      ordinary `new EventSource(url).onmessage = …` would silently receive NOTHING. A
      `data:`-only frame is delivered to `onmessage` and to every SSE library alike;
    * one source of truth for the type. Carrying it in both the `event:` field and the
      payload invites the two drifting apart, and a client that trusts the frame name would
      then be reading a value nothing validates.

    A client reads `type` from the parsed payload — never from the prose `fault` string.
    """
    return f"id: {event['id']}\ndata: {json.dumps(event, sort_keys=True, separators=(',', ':'))}\n\n"


@app.get("/events")
async def events(request: Request) -> StreamingResponse:
    """S6 / FR-B8: the durable event log as a live Server-Sent Events stream.

    Two halves, in this order:

    1. **Replay** — every event already durable in `state.tamper_events` is sent on
       connect, so a client that subscribes AFTER the fact still learns the chain was
       corrupted. History is not a substitute for the stream, and the stream is not a
       substitute for history: S4 is only observable if both are delivered. The replay is
       closed by a `REPLAY_COMPLETE_MARKER` comment frame, so a client can tell where
       history ends and live delivery begins.
    2. **Live** — events recorded while the connection is open are pushed as they are
       produced, so a tamper detected during an append cycle reaches the client WITHIN
       that cycle instead of on the next poll.

    The subscription is registered BEFORE the replay snapshot is read, and both happen
    without an `await`, so a concurrently published event cannot slip through the gap: it
    lands in the queue and is deduplicated against the replay by `id`.

    **Delivery guarantee: AT-LEAST-ONCE.** A reconnecting client sends the last `id` it saw
    in `Last-Event-ID`; when that id is still in the replay we resume after it, but when it is
    not (evicted by the `MAX_TAMPER_EVENTS` bound, or simply unknown) we send the WHOLE replay
    rather than nothing — a duplicate is safe, a silent gap is not. Clients must therefore
    deduplicate on `id` and not assume each event is seen exactly once.

    `StreamingResponse` over an async generator is a genuine stream — no Content-Length,
    chunked transfer — and Starlette cancels the generator when the client disconnects, so
    the `finally` below always unregisters the queue (no leaked tasks or queues).
    """
    queue = EVENT_BROKER.subscribe()
    replay: list[dict[str, Any]] = []
    replayed_ids: set[str] = set()
    for ordinal, raw in enumerate(load_state().tamper_events):
        event = _event_envelope(raw, ordinal)
        replayed_ids.add(event["id"])
        replay.append(event)

    # Best-effort resume from `Last-Event-ID`. Only a known id lets us skip; an unknown one
    # replays everything (see the at-least-once note above).
    resume_from = request.headers.get("last-event-id")
    if resume_from in replayed_ids:
        already_seen = next(index for index, event in enumerate(replay) if event["id"] == resume_from)
        replay = replay[already_seen + 1 :]

    async def stream() -> AsyncIterator[str]:
        try:
            for event in replay:
                yield _sse_frame(event)
            # An SSE COMMENT frame (a line starting with ':', ignored by every SSE client by
            # spec) marking the end of history. See REPLAY_COMPLETE_MARKER: without it a
            # client cannot tell a finished replay from an in-flight one, so it cannot tell a
            # replayed event from a live one — which is exactly the ambiguity that let a
            # detection probe pass with live delivery dead.
            yield f": {REPLAY_COMPLETE_MARKER}\n\n"
            last_keepalive = time.monotonic()
            while True:
                # Polled every EVENT_POLL_S rather than only when the queue read times
                # out: a disconnect is only observable through `receive()`, so a long
                # blocking read would keep a dead client's queue alive for that whole
                # interval. The keep-alive frame itself stays on the slower heartbeat.
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=EVENT_POLL_S)
                except TimeoutError:
                    # `asyncio.TimeoutError` is the builtin `TimeoutError` on py3.11+.
                    if time.monotonic() - last_keepalive >= EVENT_HEARTBEAT_S:
                        last_keepalive = time.monotonic()
                        yield ": keep-alive\n\n"  # comment frame: ignored by SSE clients
                    continue
                if event["id"] in replayed_ids:
                    continue  # already delivered in the replay above
                yield _sse_frame(event)
        finally:
            # Runs on normal exit AND on the cancellation Starlette raises when the client
            # goes away, so every subscriber is unregistered exactly once.
            EVENT_BROKER.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get("/api/wallets")
def wallets() -> list[dict[str, Any]]:
    return list(load_state().wallets.values())


@app.get("/api/auctions")
def auctions() -> list[dict[str, Any]]:
    return list(load_state().auctions.values())


@app.get("/api/approvals")
def approvals() -> list[dict[str, Any]]:
    return list(load_state().approvals.values())


@app.get("/api/ledger")
def ledger() -> list[dict[str, Any]]:
    return load_state().credit_ledger


@app.post("/chain/tx")
def submit_tx(tx: Tx) -> dict[str, Any]:
    """Applies a transaction to the server state and anchors it on the chain."""
    with STATE_LOCK:
        state = load_state()
        seed_if_empty(state)
        # FR-B6: recompute the WHOLE chain before appending and refuse if it is invalid.
        # An invalid chain must never be extended. We raise BEFORE the dispatch below, so
        # no `apply_*` mutation runs, nothing is appended (height unchanged) and nothing is
        # persisted. 409 (not 500): the request is well-formed, it conflicts with the
        # server's current — untrustworthy — state.
        fault = _chain_fault(state)
        if fault is not None:
            # FR-B6: record a durable audit entry, then refuse. `_record_tamper_event`
            # persists only the event (never the transaction): no `apply_*` mutation runs,
            # no block is appended (height unchanged) and no business state is written.
            _record_tamper_event(state, fault, tx.type)
            raise ChainIntegrityError(fault)
        # Rows appended from this index on belong to this transaction (PRD S113).
        ledger_len_before = len(state.credit_ledger)
        if tx.type == "AUCTION_BID":
            result = apply_bid(state, BidPayload(**tx.payload))
        elif tx.type == "AUCTION_AWARD":
            result = apply_award(state, AwardPayload(**tx.payload))
        elif tx.type == "APPROVAL_DECIDE":
            result = apply_approval_decision(state, ApprovalPayload(**tx.payload))
        elif tx.type == "AUCTION_SETTLE":
            result = apply_settle(state, SettlePayload(**tx.payload))
        elif tx.type == "APPROVAL_FILE":
            result = apply_file_approval(state, FileApprovalPayload(**tx.payload))
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported tx type: {tx.type}")

        anchor = {
            "type": tx.type,
            "result": {key: result[key] for key in result if key != "state"},
        }
        block = append_block(state, [anchor])
        # Server-side invariant guard. append_block() signs with THIS process's own
        # authority keys, so a fresh block must always carry a valid 3-of-3 quorum.
        # A failure here is not a client error — it means the server's key material
        # or signing path is broken (e.g. a rotated/mismatched authority key), hence
        # 500 rather than 4xx. We POP the block first so an unverified block is never
        # left anchored, and raise before save_state() so nothing is persisted either.
        if not verify_quorum(block.hash, block.sigs):
            state.blocks.pop()
            raise HTTPException(
                status_code=500,
                detail="Server invariant violation: appended block failed the 3-of-3 authority quorum",
            )
        # PRD S113: every ledger row this transaction appended is anchored by the
        # block that carries it, so stamp the block hash onto those rows. This is
        # what makes the wallet's tx hashes genuinely on-chain rather than a local
        # content hash. Rows from earlier blocks are untouched.
        for ledger_row in state.credit_ledger[ledger_len_before:]:
            ledger_row["txHash"] = block.hash
        save_state(state)
        return {
            "ok": True,
            "blockHeight": block.height,
            "blockHash": block.hash,
            **{k: v for k, v in result.items() if k != "state"},
        }


def apply_bid(state: State, payload: BidPayload) -> dict[str, Any]:
    auction = state.auctions.get(payload.auctionId)
    if auction is None:
        raise HTTPException(status_code=404, detail=f"Unknown auction: {payload.auctionId}")
    if auction["status"] != "open":
        raise HTTPException(status_code=409, detail=f"Auction {payload.auctionId} is not open")
    wallet = wallet_of(state, payload.walletId)
    if payload.credits <= auction["reserveCredits"]:
        raise HTTPException(
            status_code=422,
            detail=f"Bid must exceed the reserve of {auction['reserveCredits']} credits",
        )
    if wallet["balanceCredits"] < payload.credits:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient credits: balance {wallet['balanceCredits']}, bid {payload.credits}",
        )

    wallet["balanceCredits"] -= payload.credits
    wallet["reservedCredits"] += payload.credits
    bid_id = f"bid-{payload.walletId}-{_now_ms()}"
    auction["bids"].append(
        {"id": bid_id, "walletId": payload.walletId, "bidder": wallet["operatorName"], "credits": payload.credits, "submittedIso": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
    )
    return {"auctionId": payload.auctionId, "bidId": bid_id, "state": state}


def apply_award(state: State, payload: AwardPayload) -> dict[str, Any]:
    auction = state.auctions.get(payload.auctionId)
    if auction is None:
        raise HTTPException(status_code=404, detail=f"Unknown auction: {payload.auctionId}")
    if auction["status"] != "open" or not auction["bids"]:
        raise HTTPException(status_code=409, detail=f"Auction {payload.auctionId} cannot be awarded")

    ranked = sorted(auction["bids"], key=lambda bid: (-bid["credits"], bid["submittedIso"]))
    winning = ranked[0]
    winner = wallet_of(state, winning["walletId"])
    for bid in auction["bids"]:
        if bid["id"] == winning["id"]:
            continue
        loser = state.wallets.get(bid["walletId"])
        if loser:
            loser["balanceCredits"] += bid["credits"]
            loser["reservedCredits"] -= bid["credits"]
    auction["status"] = "awarded"
    auction["winningBidId"] = winning["id"]
    state.credit_ledger.append(
        {"id": f"ledger-award-{payload.auctionId}-{_now_ms()}", "walletId": winner["id"], "deltaCredits": 0, "reason": f"Won auction {auction['slotName']}", "atIso": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
    )
    return {"auctionId": payload.auctionId, "winningBidId": winning["id"], "winnerWalletId": winner["id"], "state": state}


def apply_approval_decision(state: State, payload: ApprovalPayload) -> dict[str, Any]:
    approval = state.approvals.get(payload.approvalId)
    if approval is None:
        raise HTTPException(status_code=404, detail=f"Unknown approval: {payload.approvalId}")
    if approval["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Approval {payload.approvalId} already decided")
    trimmed = (payload.reason or "").strip()
    if payload.decision == "rejected" and not trimmed:
        raise HTTPException(status_code=422, detail="A rejection reason is required")

    wallet = wallet_of(state, approval["walletId"])
    if payload.decision == "rejected":
        wallet["balanceCredits"] += approval["creditsEscrowed"]
        wallet["reservedCredits"] -= approval["creditsEscrowed"]
        ledger_reason = f"Refund for rejected {approval['missionName']} — {trimmed}"
    else:
        wallet["reservedCredits"] -= approval["creditsEscrowed"]
        ledger_reason = f"Escrow burned for {approval['missionName']}" + (f" — {trimmed}" if trimmed else "")

    approval["status"] = payload.decision
    approval["decisionReason"] = trimmed or None
    state.credit_ledger.append(
        {"id": f"ledger-{payload.approvalId}-{payload.decision}-{_now_ms()}", "walletId": wallet["id"], "deltaCredits": 0 if payload.decision == "approved" else approval["creditsEscrowed"], "reason": ledger_reason, "atIso": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())}
    )
    return {"approvalId": payload.approvalId, "decision": payload.decision, "state": state}


def apply_settle(state: State, payload: SettlePayload) -> dict[str, Any]:
    """Settles an awarded auction, burning the winner's reservation and crediting
    the slot owner. Mirrors settleAuction() in src/services/creditsService.ts."""
    auction = state.auctions.get(payload.auctionId)
    if auction is None:
        raise HTTPException(status_code=404, detail=f"Unknown auction: {payload.auctionId}")
    if auction["status"] != "awarded" or not auction.get("winningBidId"):
        raise HTTPException(
            status_code=409,
            detail=f"Auction {payload.auctionId} is not in the awarded state",
        )
    winning_bid = next(
        (bid for bid in auction["bids"] if bid["id"] == auction["winningBidId"]), None
    )
    if winning_bid is None:
        raise HTTPException(
            status_code=409,
            detail=f"Winning bid {auction['winningBidId']} missing from auction {payload.auctionId}",
        )

    winner = wallet_of(state, winning_bid["walletId"])
    owner = wallet_of(state, payload.ownerWalletId)
    credits = winning_bid["credits"]

    # The winning reservation is burned on settlement, not returned to balance;
    # the corridor owner receives the credits. Both effects are applied
    # unconditionally and independently: when the winner and the owner are the
    # SAME wallet (ownerWalletId is client-supplied and unvalidated) the burn and
    # the credit both land — a deliberate net-zero move. Do NOT "optimise" this
    # into a short-circuit: the client's settleAuction() had exactly that bug and
    # it destroyed the credits while still writing the owner-credit ledger row.
    winner["reservedCredits"] -= credits
    owner["balanceCredits"] += credits
    auction["status"] = "settled"
    state.credit_ledger.append(
        _ledger(
            f"ledger-settle-{payload.auctionId}",
            payload.ownerWalletId,
            credits,
            f"Settled auction {auction['slotName']}",
        )
    )
    return {
        "auctionId": payload.auctionId,
        "ownerWalletId": payload.ownerWalletId,
        "credits": credits,
        "state": state,
    }


def apply_file_approval(state: State, payload: FileApprovalPayload) -> dict[str, Any]:
    """Escrows credits for a newly filed flight approval request. Mirrors
    fileApprovalRequest() in src/services/creditsService.ts."""
    # Duplicate ids are rejected server-only: `state.approvals` is a dict keyed by
    # id, so a duplicate would silently OVERWRITE the existing request (and its
    # escrow) instead of sitting alongside it. The client's array-based store can
    # hold duplicates and has no equivalent guard, so this 409 is deliberate and
    # must not be mirrored back into the client.
    if payload.id in state.approvals:
        raise HTTPException(status_code=409, detail=f"Approval {payload.id} already exists")
    wallet = wallet_of(state, payload.walletId)
    if wallet["balanceCredits"] < payload.creditsEscrowed:
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient credits to escrow {payload.creditsEscrowed}",
        )

    wallet["balanceCredits"] -= payload.creditsEscrowed
    wallet["reservedCredits"] += payload.creditsEscrowed
    state.approvals[payload.id] = {
        "id": payload.id,
        "missionName": payload.missionName,
        "operator": payload.operator,
        "walletId": payload.walletId,
        "requestedAtIso": payload.requestedAtIso,
        "status": "pending",
        "riskLevel": payload.riskLevel,
        "creditsEscrowed": payload.creditsEscrowed,
        "reason": payload.reason,
        "decisionReason": None,
    }
    return {
        "approvalId": payload.id,
        "status": "pending",
        "walletId": payload.walletId,
        "creditsEscrowed": payload.creditsEscrowed,
        "state": state,
    }


# ------------------------------------------- frontend adapter read endpoints
@app.get("/api/zones")
def zones() -> dict[str, Any]:
    """Serves the same ingested CAD pack the frontend bundles (single source)."""
    pack_path = Path(__file__).resolve().parent.parent / "src" / "data" / "cadRfzData.json"
    if not pack_path.exists():
        raise HTTPException(status_code=503, detail="CAD pack not found on the server host")
    return json.loads(pack_path.read_text("utf-8"))


@app.get("/api/fleet")
def fleet() -> list[dict[str, Any]]:
    return load_state().drones


@app.get("/api/missions")
def missions() -> list[dict[str, Any]]:
    return load_state().missions
