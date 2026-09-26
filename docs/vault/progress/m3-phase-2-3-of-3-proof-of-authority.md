---
type: Progress
status: done
date: 2026-09-27
tags: [progress, m3, poa, consensus, signatures, ed25519, tamper-detection, orchestration]
related: [project-north-star, m3-scope-backend-ledger-agents, settle-and-file-endpoints]
---

# M3 phase 2 — 3-of-3 Proof-of-Authority consensus (B2)

## What was attempted
- Land the north star's falsifiable #2: **3-of-3 authority signatures on every block** (PRD
  §9.1/§9.2/§9.3/§9.4, FR-B1/B4/B5, S3–S4). Add `server/authorities.py` (three Ed25519
  authorities in §9.1 order: `node:admin`, `node:agent_a`, `node:agent_b`), put `sigs` on
  `Block`, collect the quorum in `append_block`, and verify hash-linkage **and** 3 distinct valid
  signatures in `verify_chain`. Gate `POST /chain/tx` (FR-B6); expose `sigs` on `GET /chain` and
  `GET /block/{height}`.
- Schema-version the state file (`schema_version` on `State`; v1→v2 migration by **re-genesis**,
  never by re-signing legacy blocks — re-signing would fabricate provenance).

## What succeeded
- `server/authorities.py`: deterministic dev seeds (public, warned loudly at import) with
  `BUSTARON_AUTHORITY_<ID>_SEED` overrides; `BUSTARON_ENV=production` refuses to boot without all
  three. `verify_quorum` rejects a non-`Mapping` `sigs` **before** `.keys()`; `verify_signature`
  catches `(InvalidSignature, ValueError, TypeError)`.
- Hash/signature separation is clean: `_hash()` covers `{height, prev_hash, ts_ms, txs}` and
  deliberately **excludes** `sigs`/`proposer` (no cycle); `sigs` sign the finalised hash.
- **FR-B6:** `submit_tx` recomputes the whole chain **before** mutating; a corrupt chain is refused
  with **409** + `tamperDetected:true`, nothing appended or persisted, and a durable record lands in
  `State.tamper_events` (bounded by `MAX_TAMPER_EVENTS=100`), surfaced as `tamperEventCount` on
  `/api/health`.
- **Boot survival:** a hostile/malformed `state.json` no longer bricks the node at import —
  `load_state` returns an invalid-but-bootable placeholder; `/api/health` returns 200 with
  `chainValid:false`, and the corrupt file is left byte-identical.
- **S4-minimal:** `_chain_fault` logs the literal `TAMPER_DETECTED` naming the offending height, and
  `/api/health` exposes the tamper state.
- Probe grew 52 → **64** assertions; new vectors P1 (the *discriminating* forgery — `txs` rewritten
  **and** the canonical hash recomputed), P2 (boot survival under a hostile `sigs`), P3 (FR-B6
  refusal), C1 (non-mapping `sigs`).

## What succeeded — verification (supervisor, by running — not by reading)
- Official `python server/probe_api.py` on `:8000`, sole runner, ×2: **64/64**, exit 0, byte-identical
  logs (idempotent).
- **Discriminating tamper** (private port + private data dir): `sigs`-only → `valid:false`;
  `txs` + recomputed hash + re-linked tail → `valid:false` → **the quorum is load-bearing; the probe
  is not a false green.**
- Hostile `sigs` (int/list/null) end-to-end → 200 `valid:false`, **never a 500**; boot with a
  malformed file survives. 2-of-3 → invalid, height unchanged. FR-B6 → 409 refuse, nothing persisted.
- Real server log carries `TAMPER_DETECTED — block 1 hash does not match its contents`.
- Migration traps a/b/c, hostile-`sigs` crypto layer, cross-process key determinism, env rotation and
  the production gate: all green (in-process, private dir).
- Gates: `tsc` 0 · `eslint` 0 · `vite build` 0 · `vitest` **94/94**.

## What failed / blockers
- **Hostile `sigs` originally bricked the server at BOOT** (an uncaught `ValidationError` fired at
  import, so the server never bound). Found by running the app, not by reading; fixed in round 2. This
  was the blocking defect of the task.
- The probe is **not concurrency-safe** (it owns `:8000` + `server/data/state.json`): a second runner
  produced a phantom `RemoteDisconnected`. Serial runs are deterministic; it is an environment
  property, not a code defect.
- Two worker reports diverged from the filesystem this round (a "the tree was reverted" narrative; a
  "complete" claim before C1 had landed) — both caught by verifying the filesystem, not the report.

## Next
- **S6** carries the S4 remainder: `GET /events` (WebSocket) **plus** a machine-readable event `type`
  so `TAMPER_DETECTED` is first-class rather than prose. That is precisely why S4 stays PARTIAL.
- M3 phase-2 items 1 (LLM agent negotiation) and 6 (HKO weather + typhoon gate).

## Related
- `docs/vault/specs/project-north-star.md`
- `server/authorities.py`, `server/main.py`, `server/probe_api.py`
- `docs/milestone-03.md` (verification table + deliberate scope decisions)
- `docs/vault/progress/settle-and-file-endpoints.md` (the preceding M3 phase-2 task)
