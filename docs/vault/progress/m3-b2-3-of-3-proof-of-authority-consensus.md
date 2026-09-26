---
type: Progress
status: done
date: 2026-09-27
tags: [progress, m3, poa, consensus, ed25519, signatures, tamper-detection, orchestration]
related: [project-north-star, m3-scope-backend-ledger-agents, settle-and-file-endpoints]
---

# M3 phase 2 — 3-of-3 Proof-of-Authority consensus (B2)

## What was attempted
- Land the north star's **#2 falsifiable**: *"tamper-evidence is real and multi-signed"* — **3-of-3
  authority signatures on every block** (PRD §9.1–§9.4, FR-B1/B4/B5, S3–S4). Add
  `server/authorities.py` (three Ed25519 authorities in §9.1 order: `node:admin`, `node:agent_a`,
  `node:agent_b`), put `sigs` on `Block`, collect the quorum in `append_block`, and verify
  **hash linkage AND 3 distinct valid signatures** in `verify_chain`. Gate `POST /chain/tx`
  (FR-B6); expose `sigs` on `GET /chain` and `GET /block/{height}`.
- Schema-version the state file (`schema_version` on `State`; **v1→v2 migration by re-genesis**,
  never by re-signing legacy blocks).

## What succeeded
- **`server/authorities.py`.** Deterministic dev seeds (public, logged loudly at import) with
  `BUSTARON_AUTHORITY_<ID>_SEED` overrides; `BUSTARON_ENV=production` **refuses to boot** without all
  three. `verify_quorum` rejects a non-Mapping `sigs` *before* `.keys()`; `verify_signature` catches
  `(InvalidSignature, ValueError, TypeError)`.
- **Clean hash/signature separation.** `_hash()` covers `{height, prev_hash, ts_ms, txs}` and
  deliberately **excludes** `sigs`/`proposer` (no cycle); `sigs` sign the finalised hash. This is what
  lets a *sigs-only* tamper be caught even when linkage+integrity still pass.
- **FR-B6.** `submit_tx` recomputes the whole chain **before** mutating; a corrupt chain is refused
  with **409** + `tamperDetected:true`, nothing appended or persisted, and a durable record lands in
  `State.tamper_events` (bounded by `MAX_TAMPER_EVENTS=100`), surfaced as `tamperEventCount`.
- **Boot survival.** A hostile/malformed `state.json` no longer bricks the node at import —
  `load_state` returns an invalid-but-bootable placeholder; `/api/health` returns 200 with
  `chainValid:false`, and the corrupt file is left **byte-identical**.
- **S4-minimal.** `_chain_fault` logs the literal token `TAMPER_DETECTED` naming the offending height,
  and `/api/health` exposes the tamper state.
- Probe grew 52 → **64** assertions; new vectors **P1** (the *discriminating* forgery — `txs` rewritten
  **and** the canonical hash recomputed), **P2** (boot survival under hostile `sigs`), **P3** (FR-B6
  refusal), **C1** (non-mapping `sigs`).

## Verification (supervisor, by RUNNING — not by reading)
- Official `python server/probe_api.py` on `:8000`, sole runner, ×2: **64/64**, exit 0, logs
  **byte-identical**.
- **Discriminating tamper** (private port + private data dir): `sigs`-only → `valid:false`;
  `txs` + recomputed hash + re-linked tail → `valid:false` → **the quorum is load-bearing; the probe is
  not a false green.**
- Hostile `sigs` (int/list/null) e2e → 200 `valid:false`, **never a 500**; boot with a malformed file
  survives. 2-of-3 → invalid, height unchanged. FR-B6 → **409** refuse, nothing persisted.
- **Real server log** carries `TAMPER_DETECTED — block 1 hash does not match its contents`.
- Migration traps a/b/c, hostile-sigs crypto layer, cross-process key determinism, env rotation and the
  production gate: all green (in-process, private dir).
- Gates: `tsc` 0 · `eslint` 0 · `vite build` 0 · `vitest` **94/94** (14 files).

## What failed / blockers
- **Hostile `sigs` originally bricked the server at BOOT** (uncaught `ValidationError` at import-time
  `load_state`). Found by *running* the app, not by reading it; fixed by the worker in round 2. Blocking.
- The probe is **not concurrency-safe** (owns `:8000` + `server/data/state.json`): a second runner
  produced a phantom `RemoteDisconnected`. Serial runs are deterministic; the flakiness is an
  environment property, not a code defect.
- Two worker reports diverged from the filesystem this round (a "tree reverted" narrative; a "complete"
  claim before C1 had landed) — both caught by verifying the **filesystem**, not the report.

## Next
- **S6**: `GET /events` WebSocket **plus a machine-readable event `type`** so `TAMPER_DETECTED` is a
  first-class, selectable event. This is precisely what keeps **S4 PARTIAL** today.
- M3 phase-2 items 1 (LLM agent negotiation) and 6 (HKO weather + typhoon gate).

## Related
- `docs/vault/specs/project-north-star.md`
- `server/authorities.py`, `server/main.py`, `server/probe_api.py`
- `docs/milestone-03.md`
