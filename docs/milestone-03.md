# Milestone 3 — Backend Ledger + Server State (phase 1)

Status: **phase 1 complete; phase 2 underway — 3-of-3 Proof-of-Authority consensus
(B2) landed.** All four gates green (see §Verification). The rest of phase 2
(agents, streaming, weather) is not started — see §Remaining.

> This document was missing until 2026-09-27 even though the handover brief cited it.
> It is written now to close that gap.

## What was built

M3 phase 1 adds a real server behind the existing `DataBackend` seam, so the credit
ledger is hash-chained and survives reloads instead of living in React state.

### 1. Hash-chained append-only ledger — `server/main.py`

- `Block` carries `height`, `prev_hash`, `ts_ms`, `txs`, `proposer`, `hash` and
  `sigs` (the 3-of-3 authority quorum — see §7).
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

Accepts `AUCTION_BID`, `AUCTION_AWARD`, `APPROVAL_DECIDE`, `AUCTION_SETTLE` and
`APPROVAL_FILE`, applies the same business rules as the client
(`src/services/creditsService.ts`), and anchors each transaction as a block:

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

### 7. 3-of-3 Proof-of-Authority consensus (phase 2 — B2)

M3 phase 1 was a single-process **hash chain** with no signature scheme, so PRD S3
(3-of-3 authority signatures) was explicitly NOT MET. Phase 2 closes that gap.

- **`server/authorities.py` (new).** Three PoA authorities in PRD §9.1 order —
  `node:admin`, `node:agent_a`, `node:agent_b` — each holding an **Ed25519** key
  pair with `sign()` / `verify()`. Dev seeds are derived deterministically from a
  fixed salt (a dev chain is reproducible from code; nothing to commit). Each seed
  is overridable via `BUSTARON_AUTHORITY_<ID>_SEED` (64 hex chars), and under
  `BUSTARON_ENV=production` all three are REQUIRED — a missing or malformed seed
  raises `AuthorityConfigError` at import, and the dev keys are never a fallback.
- **`Block.sigs` (PRD §9.2 shape).** A map keyed by authority id, e.g.
  `{"node:admin": "<hex>", "node:agent_a": "<hex>", "node:agent_b": "<hex>"}`.
- **What is signed, and why there is no cycle.** `_hash()` is SHA-256 over
  `{height, prev_hash, ts_ms, txs}` and DELIBERATELY excludes `sigs` (and
  `proposer`). `append_block()` finalises `hash` first, then signs that hash, so the
  signatures commit to the hash rather than the hash depending on the signatures.
- **`verify_chain()` now checks three independent things per block** (PRD FR-B4 +
  FR-B5): linkage to the previous hash, integrity (the stored `hash` recomputes),
  and consensus (`verify_quorum`). `verify_quorum()` demands EXACTLY the three known
  authority ids, each verifying — an unknown id, a missing id (2-of-3), or a
  tampered signature value all fail. Distinctness is structural: `sigs` is a mapping
  keyed by id, so three entries cannot come from one authority.
- **Anchoring is conditional on the quorum.** `POST /chain/tx` verifies the block it
  just appended; on failure it POPS the block and returns `500` (a broken key set is
  a server invariant violation, not a client error) — so a block that does not carry
  a valid 3-of-3 quorum is never anchored or persisted.
- **`GET /chain` (and `GET /block/{height}`) expose `sigs` verbatim**, so the
  signatures are auditable rather than hidden. Genesis is minted through
  `append_block()` and is signed like any other block.
- **Genesis signers — PRD §9.3 vs FR-B1 (reading recorded deliberately).** §9.3's table
  names the GENESIS *signers* as "Admin + Drone A + Drone B", which conflicts with FR-B1's
  three PoA *authorities*. We read §9.1/FR-B1 as governing the **consensus** signers (the
  three authorities, `node:admin` / `node:agent_a` / `node:agent_b`) and §9.3 as describing
  the genesis **payload** actors (mission, constraints, drone public keys, RFZ/weather
  hashes). So every block — genesis included — carries the 3-of-3 *authority* quorum, and
  drones stay signing clients (FR-B2), never consensus participants. The alternative
  (drones as consensus signers) would contradict FR-B1 and §9.2's `sigs` keying by node id.
- **Tamper coverage.** `server/probe_api.py` drives five independent vectors against
  fresh copies of the same good chain — corrupt `txs`, corrupt one signature value,
  delete one signature (2-of-3), inject an unknown authority id, and **forge `txs` and
  recompute every later `prev_hash`/`hash`**. The last is the one a *hash-only* verifier
  would ACCEPT: the chain is hash-consistent again, so only the authority quorum can
  reject it. Each vector must make `chainValid` false AND leave the chain height
  unchanged: the server REPORTS a tampered chain as invalid, it never silently re-seeds
  or rewrites it.
- **Tamper reporting (PRD S4 — PARTIAL).** The single detection point is `_chain_fault()`:
  on the first fault it logs the literal token **`TAMPER_DETECTED`** naming the offending
  block height, and `/api/health` exposes `chainValid`, `tamperDetected`, `chainFault` and
  `tamperEventCount`. `status` is LIVENESS only, so a poller must read
  `chainValid`/`tamperDetected`, not `status`. A refused write is additionally recorded as a
  **durable** entry in `State.tamper_events` (persisted with the rest of the state) — a
  tamper cannot be recorded as a block, since that would append to the very chain just
  declared untrustworthy. The `GET /events` **stream** is deliberately left to S6, so S4 is
  **PARTIAL, not MET**.
- **An invalid chain cannot be extended (PRD FR-B6).** `POST /chain/tx` recomputes the
  WHOLE chain before appending and refuses with `409` (`ChainIntegrityError`, whose body
  carries `tamperDetected: true`) when it is invalid. The `apply_*` mutation never runs, so
  nothing is appended (height unchanged) and no business state is persisted — only the
  tamper event is recorded.

#### State migration (schema_version 1 → 2)

`State` now carries a `schema_version` (written into `state.json`). A stored file
that predates signature support (`schema_version < 2`, or no such key) holds blocks
with no `sigs`, which can never satisfy the quorum — `verify_chain()` would report
the chain invalid forever. `load_state()` therefore **re-seeds a fresh, fully-signed
chain and logs a WARNING**, rather than:

- re-signing the legacy blocks — that would **fabricate provenance**, minting
  signatures for blocks no authority ever approved; or
- silently serving a permanently-invalid chain.

Re-seeding is lossless here: `state.json` is untracked dev data and `seed_if_empty()`
rebuilds it deterministically. A blanked file (the probe's `{}` re-seed signal) has
nothing to migrate, so it is re-seeded silently to avoid a misleading warning on
every clean boot.

#### Corrupt-file handling — a malformed file must not brick the boot

`seed_if_empty(load_state())` runs **at import**, so a `state.json` that makes `json` or
Pydantic raise would stop the server from ever binding — a *boot brick*, strictly worse
than a failed request. `load_state()` therefore catches `OSError` / `UnicodeDecodeError` /
`JSONDecodeError` / `ValidationError` (and a non-object document, or a non-integer
`schema_version`) and returns a **bootable placeholder** flagged with `load_error`: the
process comes up, `/api/health` reports `chainValid: false` with the fault, and the
corrupt file is **left untouched on disk**.

A corrupt **v2** file is NEVER re-seeded — self-healing it would erase the evidence of
tampering. Only a genuine **v1 legacy** file is re-seeded (above). `seed_if_empty()` skips
any state carrying `load_error`, and `load_error` is declared `exclude=True` so it can
never be serialised back to disk.

## Verification (2026-09-27)

| Gate / probe | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 |
| `eslint . --max-warnings=0` | exit 0 |
| `vitest run` | **94 passed / 14 files** |
| `bun scripts/probe_lifecycle.ts` | **38/38** |
| `bun scripts/probe_routes.ts` | **42/42** |
| `bun scripts/probe_m3_seam.ts` | **7/7** |
| `python server/probe_api.py` | **63 assertions** (current; 41 pre-B2) |

`probe_api.py` is self-contained: it kills any listener on `:8000`, re-seeds from
scratch, starts the server itself, and asserts absolute seed balances — so it is
repeatable.

### Phase 2 — B2 verification

- `tsc -b` exit 0; `vite build` exit 0; `eslint . --max-warnings=0` exit 0;
  `vitest run` **94 passed / 14 files**.
- `python server/probe_api.py` (Supervisor-owned runner — the only probe runner)
  now asserts the B2 contract: 4 signature-presence checks, **five independent tamper
  vectors** (corrupt `txs`, corrupt one signature value, drop one signature → 2-of-3,
  inject an unknown authority id, and **forge `txs` with every later `hash` recomputed**),
  the FR-B6 refusal (409 + durable tamper event), hostile-`sigs` boot survival, and the
  `/api/health` tamper surface — each asserting `chainValid` false AND the height
  unchanged. **63 assertions** (up from 41).
- Independent reviewer harnesses covered the crypto core (19/19), a real-uvicorn
  HTTP + migration/tamper matrix (20/20) and the anchoring invariant (7/7).
- The `vite build` gate must be run against a fresh output dir: emptying a
  pre-existing `dist/` trips the host's bulk-delete guard (73 deletions > 50/turn),
  which is an environment guard, not a build failure (77 modules transform cleanly).

## Deliberate scope decisions

- **Single-process chain, not a peer network — but now genuinely multi-signed.**
  There is still no peer/gossip model (the three authorities are co-located in one
  process, which is what the demo requires), but every block now carries a real
  3-of-3 Ed25519 authority quorum, so **PRD S3 is MET** (§7 above). A peer network
  remains out of scope.
- **`TXType` lists only implemented types.** `AUCTION_SETTLE` and `APPROVAL_FILE` were
  once declared in `TXType` with no dispatch branch, so a client could pass schema
  validation and then receive `400 Unsupported tx type`. Both are now genuinely
  implemented (`apply_settle` / `apply_file_approval`) and re-advertised;
  `UNIMPLEMENTED_TX_TYPES` holds only `GENESIS`, which is minted at seed time and is
  not client-submittable.
- **PRD S4 is PARTIAL, not MET.** Tampering is now *detected and reported*: `_chain_fault()`
  logs `TAMPER_DETECTED` naming the offending block height, `/api/health` exposes
  `chainValid` / `tamperDetected` / `chainFault` / `tamperEventCount`, a refused write leaves
  a durable entry in `State.tamper_events`, and `POST /chain/tx` refuses to extend a corrupt
  chain (FR-B6). The `GET /events` **stream** — the remaining part of S4 — is deliberately
  deferred to S6, so S4 is recorded as **PARTIAL**.
- **Fleet/mission data stays client-side.** `/api/fleet` and `/api/missions` exist but
  serve `state.drones` / `state.missions`, which are never seeded — the frontend still
  returns mock data for these. Moving them server-side is phase-2 work.

## Remaining for M3 (phase 2)

1. LLM agent negotiation protocol (PRD §8): conflict detection, fixed maneuver menu,
   two rounds, deterministic tie-break, ≤5 s budget.
2. WebSocket `/events` stream (S6).
3. HKO weather poller with a 5-minute cache, `STALE` flag and typhoon gate (§5.2).
4. Move fleet/mission data server-side so the simulation tick comes from the API.
5. Ledger coverage: `placeBid` and `fileApprovalRequest` currently emit no ledger row.

> Done since this list was first written: the 3-of-3 PoA consensus (B2) and the
> `AUCTION_SETTLE` / `APPROVAL_FILE` endpoints, the latter in commit `f37f974`.
