# PRD Status Review — full re-score of S1–S129 @ `d4ba385`

**Date:** 2026-09-27 · **Author:** orchestration lead
**Deliverable:** `docs/prd-status-review.md`
**Supersedes:** `.workbuddy-ai/verification/ws-d-prd-conformance.md` (scored at `8a584fc`)

## Why it was needed

The standing PRD matrix was scored at `8a584fc`. HEAD had advanced five commits past it (B3, B4,
T12, S91, T13, T14, T15) with **no trace entry for T13–T15**, so the matrix no longer described the
repo. Every verdict was re-derived from source.

## State at review time

```
tsc -b    0
eslint .  0 (--max-warnings=0)
vitest    144 passed / 23 files
pytest    131 passed          -> S91 count requirement (>=60) MET
ruff      server scripts tests -> 0
tree      clean
```

## Result

| Verdict | Now | Was |
|---|---|---|
| MET | 34 | 7 |
| PARTIAL | 21 | 18 |
| NOT MET | 13 | 39 |
| NOT ATTEMPTED | 59 | 63 |
| UNVERIFIED | 2 | 2 |

## The priority question

**The PRD states no per-criterion priority.** §17 opens: *"No criterion is optional. No criterion
may be skipped."* All 129 are P0 by declaration. The only ordering signal is milestone sequencing
(M1→M6), which the deliverable uses as its key: **P0 in-scope** / **P1 later milestone** /
**P0-BLOCKED**.

## Defects found by scoring from source rather than commit messages

1. **T13/T14/T15 unlogged** — no TRACE, no vault note. Same failure class as STEP 0 run 2.
2. **T15 light theme vs PRD FR-OP-V1 (dark).** `--color-bg` → `#f5f6f8`, Mapbox `dark-v11` →
   `streets-v12`, no dark palette, no `prefers-color-scheme`. README still says "dark tactical".
   Code, PRD and README now disagree.
3. **Skycell grid drift.** Frontend `SKYCELL_SIZE_M = 500` vs `server/agents.py` `600.0`, with
   different bounds. "Cell" means two different things in engine and on map — a correctness bug.
4. **T14's "risk scoring" does not exist.** `grep risk_score|riskScore` → 0 hits. S43 NOT MET.
5. **S36 is PARTIAL.** `wind_cost_factor()` exists and is probed but is not wired into the agent
   planner; its own docstring calls that a follow-up.
6. **PRD self-contradiction on zone counts** (carried forward): S98/S101 demand 286 (261+25);
   S99 demands dedupe. Correct dedupe = 284 (260+24). Both cannot hold.

## Structural reading

The M3 backend is now substantially real (3-of-3 PoA, tamper events, SSE, wired negotiation engine,
live HKO poller) and the M1–M3 web surface is close to complete. **95 of 129 remain unfinished**, but
59 of those are later-milestone scope never started. The 13 NOT MET are the genuinely late ones —
and 8 of those 13 are the admin dashboard surface (S120 sidebar, S122/S123/S124 views).
