# Milestone 3 — Backend Ledger + Server State (phase 1)

Status: **phase 1 complete; phase 2 underway — 3-of-3 Proof-of-Authority consensus
(B2), the event/query surface (B3) and the §8 negotiation protocol (B4) landed.** All four
gates green (see §Verification) and `ruff check server/` is clean. The rest of phase 2
(HKO weather poller, server-side simulation tick) is not started — see §Remaining.

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
- **Tamper reporting (PRD S4 — MET as of B3).** The single detection point is `_chain_fault()`,
  which now returns a `ChainFault` carrying a stable machine-readable `code`
  (`STATE_FILE_UNREADABLE` / `BLOCK_LINK_BROKEN` / `BLOCK_HASH_MISMATCH` / `QUORUM_INVALID`)
  beside the human prose. `/api/health` exposes `chainValid`, `tamperDetected`, `chainFault`,
  **`chainFaultCode`**, **`chainFaultHeight`**, `tamperEventCount` and **`eventSubscribers`**.
  `status` is LIVENESS only, so a poller must read `chainValid`/`tamperDetected`, not `status`.
  A refused write is additionally recorded as a **durable** entry in `State.tamper_events`
  (persisted with the rest of the state) — a tamper cannot be recorded as a block, since that
  would append to the very chain just declared untrustworthy. Each durable record is delivered
  to clients as `{id, type:"TAMPER_DETECTED", atMs, source, faultCode, height, fault}`, so the
  type is selectable **without string-matching prose**, and `GET /events` pushes it to a
  connected client within one append cycle. That is what closes S4.
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

### 8. Event stream + machine-readable event type (phase 2 — B3)

Closes **S6** and lifts **S4** from PARTIAL to MET. The acceptance record had held S4 back
for one reason: *"`GET /events` is unimplemented and the durable record carries no
machine-readable event type, so `TAMPER_DETECTED` is selectable only by string-matching
prose. A log line is not a delivery surface."*

- **Machine-readable type at the source.** `_chain_fault()` returns a `ChainFault`
  (`code` + `height` + prose) instead of a bare string, so the *single* detection point emits
  a stable token. Durable records are `{id, type:"TAMPER_DETECTED", atMs, source, faultCode,
  height, fault}`.
- **Legacy records are upgraded ON READ** by `_event_envelope()`. The evidence file is never
  rewritten merely to become readable — consistent with the corrupt-file rule above, which
  forbids writing precisely when the file is suspect.
- **`GET /events`** is a `StreamingResponse(media_type="text/event-stream")` over an async
  generator: replay the durable history → emit an SSE **comment frame** `: replay-complete`
  as an *exact* history/live boundary → push new events live. The marker is deliberately not
  a timer: a late subscriber's whole replay arrives in one TCP segment, so a "quiet period"
  drain can silently mistake buffered replay for a live event.
- **Fan-out** goes through `EventBroker`. Because `submit_tx` is a sync `def` that FastAPI
  runs in a threadpool, publish crosses into the loop via `loop.call_soon_threadsafe`, and is
  a guarded no-op when no loop is bound (the import-time `_record_tamper_event` path).
- **Delivery guarantee: AT-LEAST-ONCE.** Frames carry an SSE `id:`; `Last-Event-ID` resume is
  best-effort (an unknown/evicted id replays everything rather than nothing). Clients must
  deduplicate on `id`.
- No new dependencies — stdlib `asyncio`/`contextlib`/`uuid` only. Delivered as **SSE**, which
  FR-B8 explicitly permits ("`GET /events` (WebSocket/SSE)") and which a browser `EventSource`
  consumes natively.

### 9. Negotiation protocol — engine reviewed, wired, anchored on-chain (phase 2 — B4)

PRD §8 (FR-N1..FR-N8) was the largest remaining M3 item. The engine in `server/agents.py` predates
this entry: the **PHASE 1 audit of the third orchestration run found it untracked, unwired, unprobed
and unreferenced** (`.workbuddy-ai/b4/thread.md` held one word: `[BLOCKED]`). It is now reviewed,
fixed, probed and wired.

- **Five defects fixed before the module was allowed near the chain.** (1) `ALTITUDE_YIELD` climbed
  when the drone was BELOW its peer — reducing the vertical gap its own docstring promised to widen;
  the shared `yield_direction()` helper now drives both the simulation and the §8.5 envelope, and
  FR-N5's mandated unconditional `+30 m` tie-break deliberately does NOT use it. (2) `to_alt_m`
  always advertised `+30`, so the envelope could **contradict the simulated effect** (a below-peer
  drone was told it would climb into the peer). (3) The COUNTER-alternative rule compared against
  `payload["proposed"]`, a key no builder ever set — **dead code, FR-N4 unenforced**; the pair-aware
  `validate_exchange()` now enforces same `conflict_id`, swapped endpoints, ACCEPT-echoes-proposal
  and COUNTER-differs-from-proposal. (4) `build_resolution` silently attributed an unknown executor
  to the peer; it raises instead. (5) The LLM path derived `fallback` from prose; it now uses an
  explicit flag AND validates the LLM exchange before accepting it — an invalid one falls back to
  the deterministic policy (FR-N8).
- **`POST /negotiate`** runs the engine and anchors **three consecutive blocks, one per message**
  (proposal → response → resolution) BEFORE the caller sees the outcome — FR-N6's "on the chain
  before execution" and S25's "acted upon only after confirmation", message by message. Each block
  is quorum-verified before `save_state()`; a failure pops it and returns 500. A conflict-free pair
  anchors **nothing** — an empty exchange is not an event.
- **`GET /negotiations`** replays anchored exchanges from the chain, grouped by `conflict_id`, with
  `latencyMs` computed from **block** timestamps — the S22 evidence, not envelope prose.
- **`NEGOTIATION` is server-minted and deliberately absent from `TXType`** (documented beside
  `GENESIS`), so it can never become an advertised-but-rejected type; a client submission is refused
  by the schema (422), not at runtime (400).
- **The FR-B6 branch is covered:** on a corrupt chain `/negotiate` refuses with **409**, records a
  durable tamper event with `source=NEGOTIATION`, appends nothing, and `/negotiations` still answers
  with `chainValid:false`.
- **No new dependencies.** `server/main.py` is now **ruff-clean** (the 9 pre-existing `E501`s fixed).

## Verification (2026-09-27)

> Current numbers are in **§Phase 2 — B3 verification** below. The table here is the
> phase-1/B2 snapshot and is kept as a historical record.

| Gate / probe | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 |
| `eslint . --max-warnings=0` | exit 0 |
| `vitest run` | **94 passed / 14 files** |
| `bun scripts/probe_lifecycle.ts` | **38/38** |
| `bun scripts/probe_routes.ts` | **42/42** |
| `bun scripts/probe_m3_seam.ts` | **7/7** |
| `python server/probe_api.py` | **64 assertions** (current; 41 pre-B2) |

`probe_api.py` is self-contained: it kills any listener on `:8000`, re-seeds from
scratch, starts the server itself, and asserts absolute seed balances — so it is
repeatable.

### Phase 2 — B4 verification

Frozen revisions, md5-checked before and after every mutation: `server/agents.py`
`71c1b2166ef5af6d8507fe718bbece27`; `server/main.py` `9c2247d99a173097a6085209f38987d8`
(both LF-only).

| Gate / probe | Result |
|---|---|
| `tsc -b` · `vite build` · `eslint . --max-warnings=0` · `vitest run` | 0 · 0 · 0 · **128/128 (21 files)** |
| `python server/probe_agents.py` (new — no server required) | **ALL CHECKS PASSED**, 40 checks; FR-N7 measured ≈ **0.42 ms** per exchange |
| `python server/probe_api.py` (official runner, sole runner on `:8000`) | **ALL CHECKS PASSED / exit 0** — 14 new negotiation checks incl. the corrupt-chain refusal |
| `bun scripts/probe_lifecycle.ts` · `probe_routes.ts` · `probe_m3_seam.ts` | ALL PASS · **42/42** · ALL PASS |
| `ruff check server/` | **0 errors** (was 15) |
| **ACID TEST A** — old yield direction + `validate_exchange` neutered | **10 FAILED / exit 1**, incl. `to_alt_m=100.0 simulated=130.0` |
| **ACID TEST B** — anchoring loop mutated to append only the proposal | **4 FAILED / exit 1** — `[2]`, `2 -> 3`, empty replay group |

Both mutated revisions were restored byte-for-byte (md5 match) before the final green run.

### Phase 2 — B3 verification

Run by the Supervisor on a **frozen revision**, md5-checked before *and* after every
mutation (`server/main.py` `d21079a3…` LF-only; `server/probe_api.py` `f3f55d2d…`).

| Gate / probe | Result |
|---|---|
| `python server/probe_api.py` (sole runner, `:8000`, pristine) | **92 PASS / 0 FAIL / exit 0** |
| same, ×3 consecutive runs, label sets diffed | **92 / 92 / 92 — identical** |
| **acid test** — `EventBroker.publish()` → early `return` | **6 FAILED / exit 1** — exactly the six live assertions; the other 19 S6 lines still PASS |
| `tsc -b` · `eslint . --max-warnings=0` · `vitest run` | 0 · 0 · **128 passed / 21 files** |
| `bun scripts/probe_lifecycle.ts` · `probe_routes.ts` · `probe_m3_seam.ts` | 38/38 · 42/42 · **7/7** |
| real browser `EventSource` (`:4173` → `:8000`) | `onopen`, no error; received the live `{type:"TAMPER_DETECTED", faultCode:"BLOCK_HASH_MISMATCH", height:1}` |

The acid test is the load-bearing evidence: **a green probe is not evidence until it has been
watched going red.** Round 1 of B3 shipped a probe that printed `ALL CHECKS PASSED` with live
delivery *completely disabled*; the six live assertions now fail when it is dead and pass when
it is alive. The `: replay-complete` boundary assertion carries that discrimination — do not
relax it.

### Phase 2 — B2 verification

- `tsc -b` exit 0; `vite build` exit 0; `eslint . --max-warnings=0` exit 0;
  `vitest run` **94 passed / 14 files**.
- `python server/probe_api.py` (Supervisor-owned runner — the only probe runner)
  now asserts the B2 contract: 4 signature-presence checks, **five independent tamper
  vectors** (corrupt `txs`, corrupt one signature value, drop one signature → 2-of-3,
  inject an unknown authority id, and **forge `txs` with every later `hash` recomputed**),
  the FR-B6 refusal (409 + durable tamper event), hostile-`sigs` boot survival, and the
  `/api/health` tamper surface — each asserting `chainValid` false AND the height
  unchanged. **64 assertions** (up from 41).
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
- ~~**PRD S4 is PARTIAL, not MET.**~~ **Superseded by B3 (commit `511dd66`) — S4 is now MET.**
  Tampering is detected *and observable*: `_chain_fault()` returns a `ChainFault` whose
  `code` is a stable machine-readable token (`STATE_FILE_UNREADABLE` / `BLOCK_LINK_BROKEN` /
  `BLOCK_HASH_MISMATCH` / `QUORUM_INVALID`); durable records carry
  `type:"TAMPER_DETECTED"` + `faultCode` + `height`; and `GET /events` is a live SSE stream
  that replays history and then pushes a new event **within one append cycle**, verified
  end-to-end in a real browser `EventSource`. The original deferral note is kept below for
  the record, because the reason it was held back is what B3 had to answer.
  <br>*(as recorded before B3)* `GET /events` **stream** was deliberately deferred to S6, so
  S4 was recorded as PARTIAL. A log line is not a delivery surface.
- ~~**Fleet/mission data stays client-side.**~~ **Partly superseded.** `/api/fleet` and
  `/api/missions` now serve **seeded** `SEED_DRONES` / `SEED_MISSIONS` rows, so the endpoints
  are no longer vacuous and north-star bullet 5 is satisfied for them. **Still open:** the
  *simulation tick* is still computed client-side (`M3Backend.simulateTick` delegates to the
  mock service) — moving the tick server-side remains phase-2 work.

## Remaining for M3 (phase 2)

1. ~~LLM agent negotiation protocol (PRD §8): conflict detection, fixed maneuver menu,
   two rounds, deterministic tie-break, ≤5 s budget.~~ **Delivered as B4** — see §9 below.
2. HKO weather poller with a 5-minute cache, `STALE` flag and typhoon gate (§5.2).
3. Move the **simulation tick** server-side (the fleet/mission *data* is now seeded; the
   tick itself is still computed client-side).
4. Ledger coverage: `placeBid` and `fileApprovalRequest` currently emit no ledger row.

> Done since this list was first written: the 3-of-3 PoA consensus (B2), the
> `AUCTION_SETTLE` / `APPROVAL_FILE` endpoints (`f37f974`), the server-side seeding of
> fleet/mission rows (STEP 0, `e961303`), and the `/events` event stream + machine-readable
> event type (B3, `511dd66`) — which closes S6 and lifts S4 from PARTIAL to MET.
>
> Note on item 2 of the original list ("WebSocket `/events` stream (S6)"): delivered as
> **SSE** rather than WebSocket. FR-B8 reads "`GET /events` (WebSocket/SSE)" — SSE is the
> permitted alternative, needs no new dependency, and is what a browser `EventSource`
> consumes natively. Verified with a real `EventSource` client.
