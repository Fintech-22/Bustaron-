"""One PoA chain node — exactly ONE authority per OS process (PRD §4.4, §9.1).

    python server/chain_node.py --port 8201 --authority node:admin
    python server/chain_node.py --port 8202 --authority node:agent_a
    python server/chain_node.py --port 8203 --authority node:agent_b

Why this exists: M3 phase 2 produced a real 3-of-3 Ed25519 quorum, but all three keys
lived in one process — the demo could not answer "where are the three nodes?". This
process holds its OWN key (generated on first run into a key file, never derived from
source) and exposes only what a signer must:

    GET  /node/health  -> {authorityId, port, publicKeyHex, pid, keyFile, startedAtMs}
    POST /node/sign    -> {"hash": "<64 hex>"} -> {authorityId, sig}      (its OWN authority)

It deliberately has NO endpoint that signs for another authority, and no route that
accepts a private key over the wire. The API server (`server/main.py`) collects the
quorum by calling three of these when `BUSTARON_NODES` is set, and verifies blocks
against the PUBLIC keys these nodes publish into the keys dir — so a node that is down
means no quorum, not a silent single-process fallback.

Env/args:
    --keys-dir  where `<authority>.pub` files are published (default server/data/keys)
    --key-file  the node's private key file (default <keys-dir>/<authority>.key)
    --seed-hex  deterministic key for tests (64 hex chars); never used in production
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path
from typing import Any

from server.authorities import (
    AUTHORITY_SPECS,
    Authority,
    AuthorityConfigError,
    key_file_name,
    load_or_create_authority_key,
    write_public_key,
)
from server.json_http import serve

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("bustaron.chain_node")

DEFAULT_KEYS_DIR = Path(__file__).resolve().parent / "data" / "keys"
AUTHORITY_IDS = tuple(authority_id for authority_id, _role in AUTHORITY_SPECS)


def build_routes(
    authority: Authority, key_file: Path, keys_dir: Path, started_at: int, state: dict[str, int]
) -> dict[str, Any]:
    def health(_body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return 200, {
            "authorityId": authority.id,
            "role": authority.role,
            # Read from `state`, which main() fills with the REAL bound port (a caller may
            # legitimately pass --port 0 to ask the OS for one).
            "port": state["port"],
            "publicKeyHex": authority.public_key_hex,
            "keyFile": str(key_file),
            "keysDir": str(keys_dir),
            "pid": os.getpid(),
            "startedAtMs": started_at,
        }

    def sign(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        block_hash = body.get("hash")
        if not isinstance(block_hash, str) or len(block_hash) != 64:
            return 400, {"error": "body must carry a 64-character hex `hash`"}
        try:
            bytes.fromhex(block_hash)
        except ValueError:
            return 400, {"error": "`hash` is not hex"}
        signature = authority.sign(block_hash)
        # One line per signature: the probe reads it to prove the signature came from THIS
        # process rather than from a co-located key.
        logger.info("signed %s… as %s", block_hash[:16], authority.id)
        return 200, {"authorityId": authority.id, "sig": signature, "pid": os.getpid()}

    return {"GET /node/health": health, "POST /node/sign": sign}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="One PoA authority, one process (PRD §4.4).")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--authority", choices=AUTHORITY_IDS, required=True)
    parser.add_argument("--keys-dir", default=str(DEFAULT_KEYS_DIR))
    parser.add_argument("--key-file", default=None)
    parser.add_argument("--seed-hex", default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    keys_dir = Path(args.keys_dir)
    key_file = Path(args.key_file) if args.key_file else keys_dir / key_file_name(args.authority)
    started_at = int(time.time() * 1000)
    try:
        authority = load_or_create_authority_key(key_file, args.authority, args.seed_hex)
    except AuthorityConfigError as exc:
        logger.error("cannot start %s: %s", args.authority, exc)
        return 2
    published = write_public_key(authority, keys_dir)
    logger.info("authority %s ready (public key published to %s)", args.authority, published)
    state = {"port": args.port}
    routes = build_routes(authority, key_file, keys_dir, started_at, state)
    httpd = serve(args.port, routes, name=f"chain-{args.authority.replace(':', '_')}")
    state["port"] = httpd.server_port
    print(
        f"chain node {args.authority} on 127.0.0.1:{httpd.server_port} "
        f"(pid {os.getpid()}, pub {authority.public_key_hex[:16]}…, file {published})",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("stopping %s", args.authority)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
