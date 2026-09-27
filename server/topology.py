"""Launch the PRD §4.4 process topology: 3 chain nodes (8201–8203) + 2 agents (8101–8102).

    python server/topology.py up      # start the sibling processes, print their pids
    python server/topology.py status  # ask each process who it is
    python server/topology.py down    # stop them

This is a LAUNCHER, not a supervisor: it starts each process detached from this one and
prints what it started, and `down` re-derives the pids from the health endpoints (so a
shell that lost its manifest can still clean up). The API server is deliberately NOT
started here — it takes `BUSTARON_NODES`/`BUSTARON_AGENTS`, and deciding when to point it
at a topology is the operator's call:

    BUSTARON_NODES=http://127.0.0.1:8201,http://127.0.0.1:8202,http://127.0.0.1:8203 \
    BUSTARON_AGENTS=http://127.0.0.1:8101,http://127.0.0.1:8102 \
    python -m uvicorn server.main:app --port 8000

`server/probe_topology.py` drives this same module, so the launcher is exercised by the
probe rather than being a script nobody runs.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


def _add_repo_root_to_path() -> None:
    """Puts the repo root on sys.path so `server.*` imports resolve.

    Run as `python server/topology.py`, sys.path[0] is `server/` and `server.authorities`
    does not exist; walk up to the first ancestor that holds `server/topology.py`. (The
    child processes are launched with `-m` and therefore need none of this.)
    """
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor / "server" / "topology.py").is_file():
            if str(ancestor) not in sys.path:
                sys.path.insert(0, str(ancestor))
            return


_add_repo_root_to_path()

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KEYS_DIR = Path(__file__).resolve().parent / "data" / "keys"

#: PRD §4.4 order.
NODE_SPECS: tuple[tuple[str, int], ...] = (
    ("node:admin", 8201),
    ("node:agent_a", 8202),
    ("node:agent_b", 8203),
)
AGENT_SPECS: tuple[tuple[str, int], ...] = (("drone-a", 8101), ("drone-b", 8102))


@dataclass
class Sibling:
    """One spawned process: what it is, where it answers, and how to stop it."""

    kind: str  # "node" | "agent"
    name: str  # authority id or drone id
    port: int
    process: subprocess.Popen[bytes]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def health_path(self) -> str:
        return "/node/health" if self.kind == "node" else "/agent/health"


def _spawn(args: list[str], log_path: Path | None) -> subprocess.Popen[bytes]:
    stdout: object = subprocess.DEVNULL
    handle = None
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handle = log_path.open("ab")
        stdout = handle
    process = subprocess.Popen(
        [sys.executable, *args],
        cwd=str(REPO_ROOT),
        stdout=stdout,  # type: ignore[arg-type]
        stderr=subprocess.STDOUT if handle is not None else subprocess.DEVNULL,
    )
    if handle is not None:
        handle.close()  # the child owns its own copy of the descriptor now
    return process


def start_chain_node(
    authority_id: str,
    port: int,
    keys_dir: Path,
    log_path: Path | None = None,
    seed_hex: str | None = None,
) -> Sibling:
    # `-m` (not a script path): sys.path[0] becomes the repo root, so the child can import
    # `server.*`. Running it as `python server/chain_node.py` would put `server/` itself on
    # sys.path and the first `from server.authorities import ...` would fail.
    args = [
        "-m", "server.chain_node",
        "--port", str(port),
        "--authority", authority_id,
        "--keys-dir", str(keys_dir),
    ]
    if seed_hex:
        args += ["--seed-hex", seed_hex]
    return Sibling("node", authority_id, port, _spawn(args, log_path))


def start_agent(drone_id: str, port: int, chain_url: str, log_path: Path | None = None) -> Sibling:
    args = [
        "-m", "server.agent_node",
        "--port", str(port),
        "--drone", drone_id,
        "--chain-url", chain_url,
    ]
    return Sibling("agent", drone_id, port, _spawn(args, log_path))


def stop(sibling: Sibling) -> None:
    sibling.process.terminate()
    try:
        sibling.process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        sibling.process.kill()


def stop_all(siblings: list[Sibling]) -> None:
    for sibling in siblings:
        stop(sibling)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PRD §4.4 process topology launcher.")
    parser.add_argument("action", choices=["up", "down", "status"])
    parser.add_argument("--keys-dir", default=str(DEFAULT_KEYS_DIR))
    parser.add_argument("--chain-url", default=os.environ.get("BUSTARON_CHAIN_URL", "http://127.0.0.1:8000"))
    args = parser.parse_args(argv)

    from server.json_http import RemoteCallError, get_json

    if args.action == "status":
        for kind, specs in (("node", NODE_SPECS), ("agent", AGENT_SPECS)):
            for name, port in specs:
                url = f"http://127.0.0.1:{port}/{'node/health' if kind == 'node' else 'agent/health'}"
                try:
                    body = get_json(url, timeout_s=2.0)
                    print(f"UP    {kind:5} {name:14} port {port} pid {body.get('pid')}")
                except RemoteCallError:
                    print(f"DOWN  {kind:5} {name:14} port {port}")
        return 0

    if args.action == "down":
        for kind, specs in (("node", NODE_SPECS), ("agent", AGENT_SPECS)):
            for name, port in specs:
                url = f"http://127.0.0.1:{port}/{'node/health' if kind == 'node' else 'agent/health'}"
                try:
                    body = get_json(url, timeout_s=2.0)
                except RemoteCallError:
                    continue
                pid = body.get("pid")
                if isinstance(pid, int):
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)
                    print(f"stopped {kind} {name} (pid {pid})")
        return 0

    keys_dir = Path(args.keys_dir)
    siblings: list[Sibling] = []
    for authority_id, port in NODE_SPECS:
        siblings.append(start_chain_node(authority_id, port, keys_dir))
    for drone_id, port in AGENT_SPECS:
        siblings.append(start_agent(drone_id, port, args.chain_url))
    for sibling in siblings:
        print(f"started {sibling.kind} {sibling.name} on {sibling.url} (pid {sibling.process.pid})")
    print(
        "\npoint the API at the topology with:\n"
        f"  BUSTARON_NODES={','.join(f'http://127.0.0.1:{port}' for _name, port in NODE_SPECS)} \\\n"
        f"  BUSTARON_AGENTS={','.join(f'http://127.0.0.1:{port}' for _name, port in AGENT_SPECS)} \\\n"
        f"  BUSTARON_NODE_KEYS_DIR={keys_dir} \\\n"
        "  python -m uvicorn server.main:app --port 8000"
    )
    # Give the children a moment so an immediately-following `status` sees them up.
    time.sleep(1.5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
