"""Behavioral probe for the PRD §4.4 process topology (3 chain nodes + 2 agents).

Run: python server/probe_topology.py

It starts SIX real OS processes — three chain nodes on 8201–8203, two drone agents on
8101–8102, and one API server on an isolated port with a private data dir, private keys
dir and a private weather cache — then proves the topology is REAL rather than decorative:

* **one authority per process**: three distinct pids, three distinct public keys, each node
  answering with its own authority id;
* **the signatures come from the processes**: re-asking each node to sign the anchored block
  hash reproduces `block.sigs` BYTE-FOR-BYTE (Ed25519 is deterministic), while the API
  server's own in-process dev keys produce DIFFERENT signatures for the same hash;
* **a node down means no quorum**: the next append is refused with 503, nothing is anchored,
  and the platform does NOT fall back to local keys; the quorum self-heals when it returns;
* **an agent process does the thinking**: `/negotiate` is delegated to the agent that owns
  the drone, and the anchored transcript names that agent's pid;
* **the agent reads its mission from the chain** (S15), not from a config file.

Every process is stopped in a finally block; nothing outside `.workbuddy-ai/topology-probe`
is written.
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


def _add_repo_root_to_path() -> None:
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor / "server" / "topology.py").is_file():
            if str(ancestor) not in sys.path:
                sys.path.insert(0, str(ancestor))
            return


_add_repo_root_to_path()

from server.authorities import (  # noqa: E402  (needs the sys.path bootstrap above)
    AUTHORITY_IDS,
    read_public_keys,
    sign_block_hash,
    verify_quorum,
)
from server.json_http import RemoteCallError, get_json, post_json  # noqa: E402
from server.topology import (  # noqa: E402
    AGENT_SPECS,
    NODE_SPECS,
    Sibling,
    start_agent,
    start_chain_node,
    stop_all,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SANDBOX = REPO_ROOT / ".workbuddy-ai" / "topology-probe"
KEYS_DIR = SANDBOX / "keys"
DATA_DIR = SANDBOX / "state"
CACHE_PATH = SANDBOX / "weather_cache.json"
API_PORT = 8124
API = f"http://127.0.0.1:{API_PORT}"
NODE_URLS = {authority_id: f"http://127.0.0.1:{port}" for authority_id, port in NODE_SPECS}
AGENT_URLS = {drone_id: f"http://127.0.0.1:{port}" for drone_id, port in AGENT_SPECS}
failures = 0
siblings: list[Sibling] = []
api: subprocess.Popen[bytes] | None = None


def check(label: str, condition: bool, detail: str = "") -> None:
    global failures
    if condition:
        print(f"PASS  {label}")
    else:
        failures += 1
        print(f"FAIL  {label}{' — ' + detail if detail else ''}")


def wait_for_health(url: str, timeout_s: float = 25.0) -> dict:
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        try:
            return get_json(url, timeout_s=2.0)
        except RemoteCallError as exc:
            last = str(exc)
            time.sleep(0.4)
    raise RuntimeError(f"{url} never came up: {last}")


def start_api() -> subprocess.Popen[bytes]:
    env = dict(os.environ)
    env["BUSTARON_DATA_DIR"] = str(DATA_DIR)
    env["BUSTARON_NODE_KEYS_DIR"] = str(KEYS_DIR)
    env["BUSTARON_WEATHER_CACHE"] = str(CACHE_PATH)
    env["BUSTARON_WEATHER_OFFLINE"] = "1"
    env["BUSTARON_NODES"] = ",".join(NODE_URLS.values())
    env["BUSTARON_AGENTS"] = ",".join(AGENT_URLS.values())
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.main:app", "--host", "127.0.0.1", "--port", str(API_PORT)],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def post(path: str, body: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def clear_private_state() -> None:
    for directory in (KEYS_DIR, DATA_DIR):
        if directory.exists():
            for item in directory.iterdir():
                if item.is_file():
                    item.unlink()
    SANDBOX.mkdir(parents=True, exist_ok=True)


def bid_payload() -> dict:
    return {
        "type": "AUCTION_BID",
        "payload": {"auctionId": "auction-vh-morning", "walletId": "wallet-harbour", "credits": 90},
    }


try:
    clear_private_state()

    print("== start the topology: three nodes, then two agents ==")
    for authority_id, port in NODE_SPECS:
        siblings.append(
            start_chain_node(
                authority_id, port, KEYS_DIR,
                log_path=SANDBOX / f"{authority_id.replace(':', '_')}.log",
            )
        )
    node_health = {authority_id: wait_for_health(f"{url}/node/health") for authority_id, url in NODE_URLS.items()}
    check(
        "three chain nodes are up, one authority each",
        [node_health[a]["authorityId"] for a, _p in NODE_SPECS] == list(AUTHORITY_IDS),
        json.dumps({a: h.get("authorityId") for a, h in node_health.items()}),
    )
    check(
        "S3/§4.4: the three authorities are three distinct PROCESSES with three distinct keys",
        len({h["pid"] for h in node_health.values()}) == 3
        and len({h["publicKeyHex"] for h in node_health.values()}) == 3,
        json.dumps({a: [h["pid"], h["publicKeyHex"][:12]] for a, h in node_health.items()}),
    )
    for drone_id, port in AGENT_SPECS:
        siblings.append(start_agent(drone_id, port, API, log_path=SANDBOX / f"{drone_id}.log"))
    agent_health = {drone_id: wait_for_health(f"{url}/agent/health") for drone_id, url in AGENT_URLS.items()}
    check(
        "two drone agents are up as their own processes",
        len({h["pid"] for h in agent_health.values()}) == 2
        and [h["droneId"] for h in agent_health.values()] == [drone_id for drone_id, _p in AGENT_SPECS],
        json.dumps({d: h["pid"] for d, h in agent_health.items()}),
    )

    print("== the API server joins the topology (BUSTARON_NODES / BUSTARON_AGENTS) ==")
    api = start_api()
    api_health = wait_for_health(f"{API}/api/health")
    check(
        "the genesis block was minted BY THE NODE PROCESSES (boot order: nodes, then API)",
        api_health.get("chainValid") is True and api_health.get("chainHeight") == 1,
        json.dumps(api_health)[:200],
    )
    published = read_public_keys(KEYS_DIR)
    check(
        "the API verifies against the keys the nodes PUBLISHED, not its own dev keys",
        published is not None and all(published[a] == node_health[a]["publicKeyHex"] for a, _p in NODE_SPECS),
        "published public keys must equal the nodes' own",
    )

    print("== the signatures are the processes' own (Ed25519 is deterministic, so byte-exact) ==")
    block = get_json(f"{API}/chain")["blocks"][0]
    remote_sigs = {
        authority_id: post_json(f"{NODE_URLS[authority_id]}/node/sign", {"hash": block["hash"]}, timeout_s=5.0)["sig"]
        for authority_id, _port in NODE_SPECS
    }
    check(
        "each block signature is reproduced byte-for-byte by its node process",
        remote_sigs == block["sigs"],
        json.dumps({a: [remote_sigs.get(a, "")[:10], block["sigs"].get(a, "")[:10]] for a, _p in NODE_SPECS}),
    )
    local_sigs = sign_block_hash(block["hash"])
    check(
        "the API server's in-process dev keys did NOT sign this block (the topology really replaced them)",
        all(local_sigs[a] != block["sigs"][a] for a, _p in NODE_SPECS),
        "the dev-key signature must differ from the node signature for the same hash",
    )
    check(
        "the genesis block verifies against the published public keys",
        verify_quorum(block["hash"], block["sigs"], published) is True,
    )

    print("== one node down means NO quorum (never a silent local fallback) ==")
    victim = siblings[1]  # node:agent_a on 8202
    stop_all([victim])
    height_before = get_json(f"{API}/api/health")["chainHeight"]
    status, refused = post("/chain/tx", bid_payload())
    check(
        "FR-B6/§26: with one node down the append is refused with 503 and nothing is anchored",
        status == 503
        and refused.get("quorumAvailable") is False
        and refused.get("tamperDetected") is False
        and get_json(f"{API}/api/health")["chainHeight"] == height_before,
        f"{status} {json.dumps(refused)[:180]}",
    )
    siblings.append(
        start_chain_node(victim.name, victim.port, KEYS_DIR, log_path=SANDBOX / f"{victim.name.replace(':', '_')}.log")
    )
    wait_for_health(f"{victim.url}/node/health")
    status, recovered = post("/chain/tx", bid_payload())
    check(
        "the quorum self-heals once the node is back: the same transaction now anchors",
        status == 200 and get_json(f"{API}/api/health")["chainHeight"] == height_before + 1,
        f"{status} {json.dumps(recovered)[:140]}",
    )

    print("== the agent processes do the thinking; the server only anchors ==")
    pair = {
        "own": {"id": "drone-a", "lat": 22.300000, "lng": 114.150000, "alt_m": 100.0, "battery_pct": 80.0},
        "peer": {"id": "drone-b", "lat": 22.3017965, "lng": 114.150000, "alt_m": 100.0, "battery_pct": 80.0},
        "windowStartS": 0,
    }
    status, negotiated = post("/negotiate", pair)
    process = negotiated.get("engineProcess") or {}
    check(
        "§4.4: /negotiate is delegated to the drone's own agent process",
        status == 200
        and process.get("inProcess") is False
        and process.get("pid") == agent_health["drone-a"]["pid"]
        and process.get("droneId") == "drone-a",
        json.dumps(process),
    )
    check(
        "the anchored transcript came back through that process (three messages, three blocks)",
        len(negotiated.get("transcript") or []) == 3
        and len(negotiated.get("blocks") or []) == 3
        and (negotiated.get("conflict") or {}).get("conflictId", "").startswith("cf_"),
        json.dumps(negotiated.get("blocks")),
    )
    check(
        "the anchoring server pid is NOT the agent pid (two different processes did the work)",
        process.get("pid") != api.pid,
        f"agent={process.get('pid')} api={api.pid}",
    )

    print("== S15: the agent parses its mission FROM THE CHAIN ==")
    mission = get_json(f"{AGENT_URLS['drone-a']}/agent/mission")
    check(
        "S15: the agent read the genesis block and resolved its own mission id",
        mission.get("missionId") == "mission-vh-12"
        and (mission.get("mission") or {}).get("name")
        and mission.get("genesis", {}).get("height") == 0,
        json.dumps(mission)[:200],
    )
    check(
        "S15: it names the chain reads it performed (no local mission config)",
        mission.get("readFrom") == [f"{API}/block/0", f"{API}/api/missions"],
        json.dumps(mission.get("readFrom")),
    )
    check(
        "S15: the genesis constraints travel with the assignment",
        (mission.get("genesis", {}).get("constraints") or {}).get("minSeparationM") == 150,
        json.dumps(mission.get("genesis", {}).get("constraints")),
    )

    print("== hostile input at the node boundary ==")
    refusal = post_json(f"{NODE_URLS['node:admin']}/node/sign", {"hash": "not-hex"}, timeout_s=5.0)
    check(
        "a node refuses to sign anything that is not a 64-hex block hash",
        isinstance(refusal, dict) and "64-character" in json.dumps(refusal),
        json.dumps(refusal)[:140],
    )

finally:
    if api is not None:
        api.terminate()
        try:
            api.wait(timeout=10)
        except subprocess.TimeoutExpired:
            api.kill()
    stop_all(siblings)

print()
if failures:
    print(f"{failures} CHECK(S) FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
