---
type: Progress
status: done
date: 2026-09-27
tags: [progress, m3, settle, credits, auction, approvals, orchestration]
related: [m3-documentation-session-progress, project-north-star]
---

# M3 phase 2 — settle + file-approval endpoints

## What was attempted
- Close M3 phase-2 backlog items 3 and 4: a server-side `AUCTION_SETTLE` endpoint
  (`apply_settle`, mirroring `settleAuction()`) and `APPROVAL_FILE` (`apply_file_approval`,
  mirroring `fileApprovalRequest()`); re-advertise both in `TXType` with dispatch branches;
  narrow `UNIMPLEMENTED_TX_TYPES` to `GENESIS`; and add behavioral assertions to
  `server/probe_api.py`.

## What succeeded
- `apply_settle` / `apply_file_approval` implemented in `server/main.py`; `TXType` and
  `UNIMPLEMENTED_TX_TYPES` updated. Semantics: settle burns the winning reservation (never
  refunds it), credits ONLY the slot owner, sets status `settled`, and writes one ledger row
  `ledger-settle-<auctionId>`; file approval escrows balance→reserved with status `pending`.
  Guards: unknown→404, not-awarded→409, duplicate id→409, insufficient→422.
- New probe assertions cover the settle happy path, burn-not-refund, owner-only credit, the
  ledger row, both 404/409 guards, file escrow + pending, dup→409 and a *discriminating*
  insufficient-credits case (escrow > balance but ≤ balance+reserved).
- **Supervisor round-1 REJECT** found a real, reachable parity break: with `ownerWalletId` ==
  the winning bidder the client destroyed credits and still wrote an owner-credit ledger row.
  team-lead adjudicated the CLIENT as the defective side (a self-payment is correctly a
  net-zero wash); the server was right.
- Client `settleAuction` restructured so both effects apply on coincidence
  (`isWinner`/`isOwner` independent; winner≠owner path byte-identical); the server keeps its
  correct behaviour with a comment marking the net-zero case deliberate; discriminating
  winner==owner tests added on both sides.
- Probe harness hardened: robust `kill_server()` (kills the :8000 listener + stray uvicorn,
  waits for the port to free), `reset_state_file()` overwrites `{}` instead of unlinking
  (safe-delete-guard-proof), a `mkdir` guard so a fresh checkout works, and the missing
  `kill_server()` before the tamper re-seed.
- All gates green: `tsc` 0 · `vite build` 0 · `eslint` 0 · `vitest` **94/94 (14 files)** ·
  m3 seam **7/7** · `probe_api.py` **41/41 ×3** serially, and **41/41 from a fresh data dir**.

## What failed / blockers
- Round 1: the supervisor's prescribed fix (guard the owner credit with `ownerWalletId !=
  winner`) was WRONG — it would have introduced a bug. Retracted before the worker acted on
  it. Lesson: "mirror the client" is not the spec when the client is the defect.
- The probe is not concurrency-safe: two agents driving :8000 / `server/data/state.json`
  produce phantom failures (empty state `chainHeight 0`, "heights N -> 0", `RemoteDisconnected`).
  Serial runs are deterministic; the flakiness is an environment property, not a code defect.

## Next
- M3 phase-2 items 1 (LLM agent negotiation), 2 (3-of-3 Proof-of-Authority), 5 (WebSocket
  `/events`), 6 (HKO weather + typhoon gate) — the north-star load-bearing work.

## Related
- `docs/vault/specs/project-north-star.md`
- `server/probe_api.py`, `server/main.py`, `src/services/creditsService.ts`
