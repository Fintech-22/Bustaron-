"""BUSTARON M3 backend — FastAPI server behind the frontend's DataBackend seam.

Serves the PRD §4.4 `server` role on port 8000:
  GET  /api/health              liveness + chain stats
  GET  /api/zones               RFZ pack (same ingested CAD data the frontend uses)
  GET  /api/fleet               drone roster
  GET  /api/missions            mission list
  GET  /chain                   full PoA-style chain (append-only, hash-chained)
  GET  /block/{height}          single block by height
  POST /chain/tx               submit a transaction (auction bid, approval decision, …)
  GET  /api/auctions            open + decided auctions (server-persisted)
  GET  /api/approvals           approval queue (server-persisted)
  GET  /api/wallets             credit wallets (server-persisted)

Persistence: JSON state file (data_dir/state.json) written atomically after
every mutation — survives restarts, no external database required this
increment. The ledger is append-only and hash-chained (PRD FR-B4): each block
stores prev_hash; any tampering breaks the chain on the next verification.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="BUSTARON M3 server", version="0.1.0")

# The frontend dev/preview origins hit the API cross-origin (5173/4173).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

DATA_DIR = Path(os.environ.get("BUSTARON_DATA_DIR", Path(__file__).resolve().parent / "data"))
STATE_PATH = DATA_DIR / "state.json"
STATE_LOCK = threading.Lock()

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


class State(BaseModel):
    blocks: list[Block] = []
    wallets: dict[str, dict[str, Any]] = {}
    auctions: dict[str, dict[str, Any]] = {}
    approvals: dict[str, dict[str, Any]] = {}
    credit_ledger: list[dict[str, Any]] = []
    drones: list[dict[str, Any]] = []
    missions: list[dict[str, Any]] = []


def load_state() -> State:
    if STATE_PATH.exists():
        return State.model_validate(json.loads(STATE_PATH.read_text("utf-8")))
    return State()


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
    state.blocks.append(block)
    return block


def verify_chain(state: State) -> bool:
    prev = "0" * 64
    for block in state.blocks:
        recomputed = _hash(
            {"height": block.height, "prev_hash": block.prev_hash, "ts_ms": block.ts_ms, "txs": block.txs}
        )
        if block.prev_hash != prev or block.hash != recomputed:
            return False
        prev = block.hash
    return True


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


def seed_if_empty(state: State) -> None:
    if not state.blocks and not state.wallets:
        state.wallets = SEED_WALLETS
        state.auctions = SEED_AUCTIONS
        state.approvals = SEED_APPROVALS
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
    state = load_state()
    return {
        "status": "ok",
        "chainHeight": len(state.blocks),
        "chainValid": verify_chain(state),
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
