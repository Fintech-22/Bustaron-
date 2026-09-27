---
type: Progress
status: done
date: 2026-09-27
tags: [progress, stabilization, orchestration, m3, mapbox, regression]
related: [step-0-stabilization-audit-close-out, m3-phase-2-3-of-3-proof-of-authority, t9-mapbox-tactical-overlay-and-prd-defects-1-4-5]
---

# STEP 0 (run 2) — Stabilize the uncommitted increment

## What was attempted
- Open a second orchestration run (Overview → Supervisor → Worker + paired Reviewer) by first
  satisfying STEP 0's mandate: *"Do not start new work until the codebase builds clean and
  existing tests pass."* Read the audit, measure the tree **as found**, fix what is broken,
  log it as trace entry #0.

## What succeeded
- **Audit re-read and re-confirmed.** `VERIFICATION_AUDIT.md` + `AUDIT_SUMMARY.md`: the brief
  overstated four numbers (`probe_lifecycle` 38 not 36; skycell lattice 594 not 462;
  `probe_api` idempotent only via self-reseed; "110 RFZ polygons" viewport-dependent, 134/135).
  **286-vs-284 zones stays adjudicated**: the code is right, the PRD counts 2 byte-identical
  duplicates. Everything in that audit still stands.
- **The real finding: an entire uncommitted, unlogged, unverified feature increment was in the
  working tree.** 15 modified + 21 untracked files (15 source, 6 test), authored 04:11–04:19 of
  the previous session, never committed. The last four commits on `main` are **docs-only**;
  `.workbuddy-ai/memory/2026-09-27.md` never mentions it.
- The increment is coherent and closes PRD gaps: **S111** (7 operator sidebar entries),
  **S112** (Flight Plans CRUD), **S113** (on-chain ledger tx hashes, stamped server-side in
  `submit_tx`), **S114** (fleet roster), **S115** (derived alerts feed), plus server-side
  `SEED_DRONES`/`SEED_MISSIONS` which closes the audit's *"`/api/fleet` and `/api/missions`
  return empty arrays"* finding. `src/services/txHash.ts` is a hand-written FIPS 180-4 SHA-256
  checked against published vectors.
- **Three defects found — all invisible to `tsc`, `eslint` and `vitest`, which were green.**
  1. **[BLOCKER]** `MapboxMap.tsx` anchored two new `addLayer` calls to a `beforeId` that is added
     *later in the same function*. `Map#addLayer` **silently returns** on an unknown anchor, so
     `rfz-hatch-fill` and `weather-arrow` were **never added** and the map logged 12 errors.
     PRD FR-OP-V3/S106 and FR-OP-V5/S108 did not render on the Mapbox path. `mapOverlays.test.tsx`
     stayed green because it tests the **2D SVG** map.
  2. **[MEDIUM]** `m3Backend.fetchJson` read `.detail` off `await response.json().catch(() => ({}))`
     — `.catch()` does not cover a body that *resolves* to `null`, so a non-ok response threw
     `TypeError: null is not an object` and **destroyed the real HTTP status**. Hit on any cold
     start with `:8000` down.
  3. **[COSMETIC]** `/favicon.ico` 404 (no `public/`, no declared icon) — counted as a console
     error and **masking real ones**.
- **All three fixed, and both substantive fixes proved discriminating:**
  - Mapbox, by live measurement via the real `setBackend` path: source **284 (260 rfz + 24 sandbox)**,
    rendered **fill 134 · hatch 125 · line 135 · arrow 2**, console errors **none**. Before the fix
    `rfz-hatch-fill` was absent from `getStyle().layers` entirely. 134/135 reproduces the audit's
    independent count — nothing else regressed.
  - `fetchJson`, by **reverting the fix**: `m3Backend.test.ts` fails **2/7** pre-fix, passes
    **7/7** post-fix. New 7-case regression test added.
- Final state: `tsc` 0 · `build` 0 · `eslint` 0 · **`vitest` 128/128 (21 files)** ·
  lifecycle **38/38** · routes **42/42** · m3 seam **7/7** · **api 69/69** · **mapbox 8/8** ·
  console errors **13 → 0** · layout clean at 320/1440.

## What failed / blockers
- **`probe_api.py` cannot be run from the foreground in this sandbox.** Its `kill_server()` step
  runs PowerShell `Stop-Process -Force` on the `:8000` listener, which terminates the *calling
  shell* (SIGTERM, exit 1, zero output). Worked around by running it as a background task; result
  unaffected (69/69, exit 0). Same class as the documented `rm` block — **environment, not code**.
- **`tools/verify-mapbox.mjs` reported a spurious 5/8 once** — it was run while `vite build` was
  rewriting `dist/`. Re-run on a settled build: **8/8**. Lesson: never verify against a build that
  is still being written.

## What was NOT done (scope honesty)
- The increment's own source was **not** re-litigated — it is coherent and now verified. Its
  provenance is recorded as *unknown author, previous session, uncommitted* and it is committed
  under a trace entry that says so, rather than absorbed silently.
- No new product work was started. STEP 2 (backend/technical first) is the next step.
