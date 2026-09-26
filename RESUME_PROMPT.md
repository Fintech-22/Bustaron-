# RESUME PROMPT — paste everything below the line into the other AI

---

You are resuming an in-progress software project. Do **not** start from scratch, do not re-derive the design, and do not re-read the PRD end to end. Everything you need is already on disk.

## Step 0 — read this first (mandatory)

Working directory: `C:\Users\user\WorkBuddy AI\2026-09-24-21-39-57`

Read `HANDOFF.md` in that directory **in full** before doing anything else. It is the authoritative state document: project identity, all source-data paths, verification status, environment gotchas, the bug history, the milestone roadmap, and the exact resume point. Then read `docs/system_design.md` §1–§2 for the M1–M6 milestone definitions.

Do not begin coding until you have read both.

## Where the project stands

**BUSTARON v3** — a Hong Kong drone airspace / UTM operations platform. Vite 5.4.21 + React 18 + TypeScript 5.9.3 + Zustand 4 + Tailwind 3 + Vitest 2.1.9.

**Milestone 1 (mock-only frontend tactical shell) is complete and verified.** 20 source files, ~1,760 lines. All four gates pass as of 2026-09-26:

- `tsc -b` → exit 0
- `vite build` → exit 0
- `eslint . --max-warnings=0` → exit 0
- `vitest run` → 3/3 passing

A production build already exists in `dist/`.

## Hard rules for this environment (violating these will cost you an hour)

1. **Never run `npm install`.** `node_modules` is complete (241 packages). Reinstalling triggers the host's file-operation guard, which renames files to `*.DELETE.<hash>` instead of deleting them and silently breaks packages.
2. **Never run `npm run build|test|lint`.** Those scripts use `npm exec --package ...`, which re-resolves the registry every run and takes 3–5 minutes. Call the local binaries directly — it takes seconds:
   ```bash
   ./node_modules/.bin/tsc -b
   ./node_modules/.bin/vite build
   ./node_modules/.bin/eslint . --max-warnings=0
   ./node_modules/.bin/vitest run
   ```
3. **Check for guard damage before debugging anything weird:**
   ```bash
   find node_modules -name "*.DELETE.*"
   ```
   It must print nothing. If it prints files, repair them (see `HANDOFF.md` §4.1) — do not assume the source code is at fault.
4. The project is **not a git repository**. There is no rollback safety net. Be conservative.

## Your task, in order

**1. Baseline the project (do this first, it is 2 minutes and it protects everything after it).**
- Delete the stale vite temp file `vite.config.ts.timestamp-*.mjs` at the project root.
- `git init`, add a `.gitignore` covering `node_modules/`, `dist/`, `.npm-cache/`, `.npx-cache/`, `*.timestamp-*.mjs`, and commit everything as the M1 baseline.
- Re-run the four gates above to confirm the baseline is green. Report the commit hash.

**2. Then start Milestone 2 — Planning + data adapters.** Scope is defined in `docs/system_design.md`; do not invent a different scope.
- Introduce real adapter boundaries behind the existing mock seam at `src/services/mockDataService.ts`. Keep the mock implementation working — the app must still run with no network.
- Ingest the supplied geodata from `C:\Users\user\Downloads\bustaron_map_data\{GeoJSON,KML}`.
- Implement RFZ point-in-polygon checks and an A* route-planning service.
- Add the credits / auction UI flows (operator Credit Wallet, admin Approvals Queue).
- Add tests for the new services and run all four gates before reporting.

**3. Report back** with: files changed, gate results, and anything you could not resolve. If M2 turns out to be larger than one pass, stop and propose a split rather than leaving the tree in a broken state.

## Constraints that must not be broken

- The PRD requires the **2D tactical map to be the landing view**; the 3D/Cesium view stays hidden behind a nav tab. Do not promote 3D.
- Accessibility is a first-class requirement (WCAG AA intent): real `<button>` elements, `aria-pressed` / `aria-current`, visible focus states, semantic headings, responsive at 320/768/1024/1440.
- No generic purple-gradient AI aesthetic. The existing dark tactical theme in `src/styles/globals.css` is the design language — extend it, don't replace it.
- Testing Library queries must be scoped, e.g. `within(screen.getByRole('group', { name: /map layer controls/i }))`. Unscoped queries like `/routes/i` collide with sidebar nav descriptions — this caused a real failure already.
- Do not touch anything outside the working directory.

## Uncertainty handling

If `HANDOFF.md` and the code disagree, **trust the code** and say so explicitly. If you find that M1 is not actually green when you run the gates, stop and report before starting M2.
