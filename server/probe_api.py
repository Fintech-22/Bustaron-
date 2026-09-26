"""Behavioral probe for the M3 FastAPI backend — drives the real HTTP API and
asserts state transitions, chain integrity, tamper detection and persistence.

Run: python server/probe_api.py  (server must be running on 127.0.0.1:8000)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
STATE_PATH = Path(__file__).resolve().parent / "data" / "state.json"

failures = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global failures
    if condition:
        print(f"PASS  {label}")
    else:
        failures += 1
        print(f"FAIL  {label}{' — ' + detail if detail else ''}")


def get(path: str) -> Any:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def post(path: str, body: dict) -> tuple[int, Any]:
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def kill_server() -> None:
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"],
        capture_output=True,
        timeout=30,
    )
    time.sleep(1)


def start_server() -> None:
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Start-Process -WindowStyle Hidden -FilePath 'C:\\Program Files\\Python313\\python.exe' "
         "-ArgumentList '-m','uvicorn','server.main:app','--host','127.0.0.1','--port','8000' "
         "-WorkingDirectory 'C:\\Users\\user\\WorkBuddy AI\\2026-09-24-21-39-57'"],
        capture_output=True,
        timeout=30,
    )
    for _ in range(15):
        try:
            get("/api/health")
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("server did not come back")


# ---------------------------------------------------------------- lifecycle
health = get("/api/health")
check("health: chain valid and seeded", health["status"] == "ok" and health["chainValid"] and health["chainHeight"] >= 1, json.dumps(health))

status, bid = post("/chain/tx", {"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning", "walletId": "wallet-harbour", "credits": 90}})
check("bid accepted and anchored", status == 200 and bid.get("ok") is True and bid.get("blockHash"), json.dumps(bid)[:160])

wallets = {wallet["id"]: wallet for wallet in get("/api/wallets")}
check("bid escrow moved on the server", wallets["wallet-harbour"]["balanceCredits"] == 480 - 90 and wallets["wallet-harbour"]["reservedCredits"] == 40 + 90, json.dumps(wallets["wallet-harbour"]))

status, low_bid = post("/chain/tx", {"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning", "walletId": "wallet-harbour", "credits": 5}})
check("bid below reserve rejected with 422", status == 422 and "reserve" in low_bid.get("detail", ""), f"{status} {low_bid}")

status, award = post("/chain/tx", {"type": "AUCTION_AWARD", "payload": {"auctionId": "auction-vh-morning"}})
check("award accepted", status == 200 and award.get("winningBidId"), json.dumps(award)[:160])

auctions = {auction["id"]: auction for auction in get("/api/auctions")}
check("auction awarded with winning bid", auctions["auction-vh-morning"]["status"] == "awarded" and auctions["auction-vh-morning"]["winningBidId"] is not None)

wallets = {wallet["id"]: wallet for wallet in get("/api/wallets")}
check("loser refunded (harbour back to seed balance)", wallets["wallet-harbour"]["balanceCredits"] == 480 - 90 + 90 + 40, json.dumps(wallets["wallet-harbour"]))
check("winner reservation held (cargo)", wallets["wallet-cargo"]["reservedCredits"] == 160, json.dumps(wallets["wallet-cargo"]))

status, reject = post("/chain/tx", {"type": "APPROVAL_DECIDE", "payload": {"approvalId": "approval-cbd-04", "decision": "rejected"}})
check("rejection without reason refused", status == 422 and "reason is required" in reject.get("detail", ""), f"{status} {reject}")

status, decision = post("/chain/tx", {"type": "APPROVAL_DECIDE", "payload": {"approvalId": "approval-cbd-04", "decision": "rejected", "reason": "Harbour traffic above threshold"}})
check("rejection with reason accepted", status == 200 and decision.get("decision") == "rejected", json.dumps(decision)[:160])

approvals = {approval["id"]: approval for approval in get("/api/approvals")}
check("approval rejected with recorded reason", approvals["approval-cbd-04"]["status"] == "rejected" and approvals["approval-cbd-04"]["decisionReason"] == "Harbour traffic above threshold")

wallets = {wallet["id"]: wallet for wallet in get("/api/wallets")}
check("escrow refunded to urban", wallets["wallet-urban"]["balanceCredits"] == 260 + 80 and wallets["wallet-urban"]["reservedCredits"] == 0, json.dumps(wallets["wallet-urban"]))

status, double = post("/chain/tx", {"type": "APPROVAL_DECIDE", "payload": {"approvalId": "approval-cbd-04", "decision": "approved"}})
check("double decision refused with 409", status == 409, f"{status} {double}")

chain = get("/chain")
check("chain grew and stays valid after mutations", chain["height"] >= 4 and chain["valid"], f"height={chain['height']} valid={chain['valid']}")
check("block links by prev_hash", all(chain["blocks"][i]["prev_hash"] == chain["blocks"][i - 1]["hash"] for i in range(1, len(chain["blocks"]))))
check("single block endpoint works", get("/block/0")["height"] == 0)

# ------------------------------------------------------------ tamper detection
kill_server()
state = json.loads(STATE_PATH.read_text("utf-8"))
if len(state["blocks"]) > 1:
    state["blocks"][1]["txs"] = [{"type": "TAMPER", "note": "malicious edit"}]
    STATE_PATH.write_text(json.dumps(state), "utf-8")
    start_server()
    check("tampering detected on load (chainValid false)", get("/api/health")["chainValid"] is False)
    # Restore a clean state for persistence test by re-seeding from scratch.
    STATE_PATH.unlink()
    start_server()
else:
    STATE_PATH.unlink()
    start_server()

# ---------------------------------------------------------------- persistence
status, _ = post("/chain/tx", {"type": "AUCTION_BID", "payload": {"auctionId": "auction-vh-morning", "walletId": "wallet-harbour", "credits": 55}})
check("reseeded server accepts a bid", status == 200, f"{status}")
before = get("/api/wallets")
height_before = get("/api/health")["chainHeight"]
kill_server()
start_server()
after = get("/api/wallets")
check("state survives restart", before == after and get("/api/health")["chainHeight"] == height_before, f"heights {height_before} -> " + str(get("/api/health")["chainHeight"]))
check("chain valid after restart", get("/api/health")["chainValid"] is True)

# ------------------------------------------------------------ adapter payloads
zones = get("/api/zones")
check("zones endpoint serves the CAD pack", isinstance(zones, dict) and len(zones.get("features", [])) == 284)
check("fleet/missions endpoints respond", isinstance(get("/api/fleet"), list) and isinstance(get("/api/missions"), list))

print()
print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
sys.exit(0 if failures == 0 else 1)
