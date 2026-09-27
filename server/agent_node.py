"""One drone's ground LLM agent — one OS process per drone (PRD §4.4: 8101/8102).

    python server/agent_node.py --port 8101 --drone drone-a --chain-url http://127.0.0.1:8000
    python server/agent_node.py --port 8102 --drone drone-b --chain-url http://127.0.0.1:8000

Routes:

* ``GET /agent/health``  — identity + engine + pid (the probe asserts distinct processes).
* ``GET /agent/mission`` — the drone's assignment, **read from the chain** (PRD S15): the
  genesis block's ``GENESIS`` transaction carries the drone→mission table and the platform
  constraints, and ``/api/missions`` carries the plan itself. Do not pull missions from a
  local config file: an agent that trusts its own config is not a blockchain agent.
* ``POST /agent/negotiate`` — body ``{own, peer, windowStartS, weather?}``. Runs the SAME
  §8 engine the API server uses, validates the exchange as a pair, and returns the
  transcript. It does NOT anchor anything: thinking is the agent's job, anchoring is the
  chain's. The API server calls this when ``BUSTARON_AGENTS`` is set, then anchors what
  comes back — so the demo can show a real agent process producing the messages.
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from typing import Any

from server.agents import (
    DroneTrack,
    LLMNegotiator,
    WeatherSnapshot,
    validate_exchange,
)
from server.json_http import RemoteCallError, get_json, serve

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("bustaron.agent_node")

DEFAULT_CHAIN_URL = "http://127.0.0.1:8000"


def build_routes(drone_id: str, chain_url: str, state: dict[str, int], started_at: int) -> dict[str, Any]:
    def health(_body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return 200, {
            "droneId": drone_id,
            "port": state["port"],
            "pid": os.getpid(),
            "engine": LLMNegotiator().name(),
            "chainUrl": chain_url,
            "startedAtMs": started_at,
        }

    def mission(_body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        """S15: parse the assignment from the GENESIS transaction, then fetch the plan."""
        try:
            genesis = get_json(f"{chain_url}/block/0", timeout_s=5.0)
        except RemoteCallError as exc:
            return 503, {"error": f"chain unreachable: {exc}"}
        genesis_tx = next(
            (tx for tx in genesis.get("txs", []) if tx.get("type") == "GENESIS"),
            None,
        )
        if genesis_tx is None:
            return 502, {"error": "no GENESIS transaction in block 0"}
        assignment = (genesis_tx.get("result") or {}).get("droneMissions", {})
        mission_id = assignment.get(drone_id)
        plan: dict[str, Any] | None = None
        if mission_id is not None:
            try:
                missions = get_json(f"{chain_url}/api/missions", timeout_s=5.0)
            except RemoteCallError as exc:
                return 503, {"error": f"mission list unreachable: {exc}"}
            plan = next((row for row in missions if row.get("id") == mission_id), None)
        return 200, {
            "droneId": drone_id,
            "missionId": mission_id,
            "mission": plan,
            "genesis": {
                "height": genesis.get("height"),
                "hash": genesis.get("hash"),
                "note": genesis_tx.get("note"),
                "constraints": (genesis_tx.get("result") or {}).get("constraints"),
            },
            "readFrom": [f"{chain_url}/block/0", f"{chain_url}/api/missions"],
        }

    def negotiate(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        try:
            own = DroneTrack(**body["own"])
            peer = DroneTrack(**body["peer"])
        except (KeyError, TypeError, ValueError) as exc:
            return 422, {"error": f"own/peer tracks required: {exc}"}
        weather_raw = body.get("weather")
        weather = WeatherSnapshot(**weather_raw) if isinstance(weather_raw, dict) else None
        negotiator = LLMNegotiator()
        outcome = negotiator.negotiate(
            own, peer, int(body.get("windowStartS", 0)), int(time.time() * 1000), weather
        )
        if outcome is None:
            return 200, {"conflict": None, "engine": negotiator.name(), "transcript": [], "agentPid": os.getpid()}
        problems = validate_exchange(outcome.proposal, outcome.response)
        if problems:
            # An engine that emits an invalid exchange is THIS process's bug. Say so.
            return 500, {"error": "engine produced an invalid exchange: " + "; ".join(problems)}
        return 200, {
            "engine": negotiator.name(),
            "fallback": outcome.fallback,
            "agentPid": os.getpid(),
            "droneId": drone_id,
            "conflict": {
                "conflictId": outcome.conflict.conflict_id,
                "droneA": outcome.conflict.drone_a,
                "droneB": outcome.conflict.drone_b,
                "reason": outcome.conflict.reason,
                "minSeparationM": outcome.conflict.min_separation_m,
                "firstConflictTS": outcome.conflict.first_conflict_t_s,
            },
            "transcript": [
                envelope.model_dump(by_alias=True)
                for envelope in (outcome.proposal, outcome.response, outcome.resolution)
            ],
        }

    return {
        "GET /agent/health": health,
        "GET /agent/mission": mission,
        "POST /agent/negotiate": negotiate,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="One drone's ground agent (PRD §4.4).")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--drone", required=True, help="drone id, e.g. drone-a")
    parser.add_argument("--chain-url", default=os.environ.get("BUSTARON_CHAIN_URL", DEFAULT_CHAIN_URL))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    started_at = int(time.time() * 1000)
    state = {"port": args.port}
    routes = build_routes(args.drone, args.chain_url, state, started_at)
    httpd = serve(args.port, routes, name=f"agent-{args.drone}")
    state["port"] = httpd.server_port
    print(
        f"agent {args.drone} on 127.0.0.1:{httpd.server_port} (pid {os.getpid()}, chain {args.chain_url})",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("stopping agent %s", args.drone)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
