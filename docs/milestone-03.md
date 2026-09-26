# Milestone 3 — Backend Ledger + Server State (phase 1)

Status: **phase 1 complete, all four gates green** (see §Verification).
Phase 2 (agents, consensus, streaming, weather) is not started — see §Remaining.

> This document was missing until 2026-09-27 even though the handover brief cited it.
> It is written now to close that gap.

## What was built

M3 phase 1 adds a real server behind the existing `DataBackend` seam, so the credit
ledger is hash-chained and survives reloads instead of living in React state.

### 1. Hash-chained append-only ledger — `server/main.py`

- `Block` carries `height`, `prev_hash`, `ts_ms`, `txs`, `proposer`, `hash`.
- `append_block()` links each block to the previous block's hash; the genesis block
  uses 64 zeros as `prev_hash`.
- `verify_chain()` **recomputes** every block's SHA-256 and checks the linkage on
  every read — nothing is cached, so tampering is caught on the next request.
- Corrupting any historical block in `server/data/state.json` makes `chainValid`
  false (asserted by `server/probe_api.py`, and independently reproduced).

### 2. Server-persisted state — `server/data/state.json`

- Holds `blocks`, `wallets`, `auctions`, `approvals`, `credit_ledger`, `drones`,
  `missions`.
- `save_state()` writes to a `.json.tmp` then `os.replace()` — an atomic swap, so a
  crash mid-write cannot leave a truncated state file.
- `seed_if_empty()` seeds wallets, auctions and approvals on first boot and mints the
  genesis block.
- **State deliberately survives restarts.** Delete `server/data/state.json` to force a
  re-seed.

### 3. Transaction endpoint — `POST /chain/tx`

Accepts `AUCTION_BID`, `AUCTION_AWARD` and `APPROVAL_DECIDE`, applies the same
business rules as the client (`src/services/creditsService.ts`), and anchors each
transaction as a block:

| Rule | Failure |
|---|---|
| Bid must exceed the auction reserve | `422` |
| Bid must not exceed the wallet balance | `422` |
| Rejection requires a non-blank reason (PRD S121) | `422` |
| An approval may only be decided once | `409` |
| An auction may only be awarded while open with bids | `409` |

### 4. Read endpoints

`/api/health`, `/api/zones` (the same 284-zone CAD pack), `/api/fleet`,
`/api/missions`, `/api/wallets`, `/api/auctions`, `/api/approvals`, `/api/ledger`,
plus `GET /chain` and `GET /block/{height}`.

### 5. CORS

Restricted by regex to `localhost` / `127.0.0.1` origins — deliberately **not**
`allow_origins=["*"]`. The live UI caught the original absence of CORS: headless
`fetch` ignores it, browsers do not.

### 6. Frontend seam — `src/services/m3Backend.ts`

`M3Backend` (id `m3-server`) implements `DataBackend` and adds an optional async
`hydrate()`. It falls back to CAD composition when the server is unreachable, and the
store applies hydration asynchronously without leaving a half-hydrated state. The
source picker in the Credit Wallet panel offers `Mock replay` / `CAD RFZ GeoJSON` /
`M3 FastAPI server`.

## Verification (2026-09-27)

| Gate / probe | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 |
| `eslint . --max-warnings=0` | exit 0 |
| `vitest run` | **93 passed / 14 files** |
| `bun scripts/probe_lifecycle.ts` | **38/38** |
| `bun scripts/probe_routes.ts` | **42/42** |
| `bun scripts/probe_m3_seam.ts` | **7/7** |
| `python server/probe_api.py` | **22/22**, idempotent across consecutive runs |

`probe_api.py` is self-contained: it kills any listener on `:8000`, re-seeds from
scratch, starts the server itself, and asserts absolute seed balances — so it is
repeatable.

## Deliberate scope decisions

- **Single-process chain, not a node network.** There is no peer model and no
  signature scheme yet, so PRD S3 (3-of-3 authority signatures) is not met. The
  ledger is a hash chain, not Proof-of-Authority consensus.
- **`TXType` lists only implemented types.** `AUCTION_SETTLE` and `APPROVAL_FILE` were
  originally declared in `TXType` but had no dispatch branch, so a client could pass
  schema validation and then receive `400 Unsupported tx type`. They were removed from
  the accepted list and recorded in `UNIMPLEMENTED_TX_TYPES`; `GENESIS` is minted at
  seed time and is not client-submittable.
- **Fleet/mission data stays client-side.** `/api/fleet` and `/api/missions` exist but
  serve `state.drones` / `state.missions`, which are never seeded — the frontend still
  returns mock data for these. Moving them server-side is phase-2 work.

## Remaining for M3 (phase 2)

1. LLM agent negotiation protocol (PRD §8): conflict detection, fixed maneuver menu,
   two rounds, deterministic tie-break, ≤5 s budget.
2. 3-of-3 Proof-of-Authority multi-signer consensus (PRD §9, S3).
3. `AUCTION_SETTLE` server endpoint (`apply_settle`), mirroring
   `settleAuction()` in `creditsService.ts`.
4. `APPROVAL_FILE` server endpoint, mirroring `fileApprovalRequest()`.
5. WebSocket `/events` stream (S6).
6. HKO weather poller with a 5-minute cache, `STALE` flag and typhoon gate (§5.2).
7. Move fleet/mission data server-side so the simulation tick comes from the API.
8. Ledger coverage: `placeBid` and `fileApprovalRequest` currently emit no ledger row.
