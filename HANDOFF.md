# BUSTARON — SESSION HANDOFF

> Purpose: let any new AI/engineer resume **without re-reading the whole project**.
> Last updated: 2026-09-26 21:30 GMT+8 — **T8 UI/verification session complete, gates green.**

> ## ⚠️ READ `TRACE.md` §T8 AND `docs/vault/Index.md` BEFORE STARTING M3
> T8 (latest session) re-audited all docs vs code, closed the two open T7 UI
> defects (mobile nav disclosure, empty-Mapbox default), fixed a wallet seed
> invariant, and recorded a **compliance-correct planner behaviour change**:
> with the corrected 284-zone CAD pack, the Victoria Harbour RFZ seals
> mid-harbour transits (38/42 endpoint pairs route). PRD defects 1–6 remain
> open and are the first real M3 product work.

---

## 1. Project identity

| Item | Value |
|---|---|
| Product | **BUSTARON v3** — Hong Kong drone airspace / UTM operations platform |
| Active workspace | `C:\Users\user\WorkBuddy AI\2026-09-24-21-39-57` |
| Stack | Vite 5.4.21 + React 18 + TypeScript 5.9.3 + Zustand 4 + Tailwind 3 + Vitest 2.1.9 |
| Current milestone | **M3 in progress.** M1 shell + M2 planning/adapters verified beneath it. T7+T8 UI hardening done. |
| Source of truth PRD | `C:\Users\user\WorkBuddy AI\2026-09-20-21-42-04\BUSTARON_PRD.md` (904 lines, S1–S129) |
| Geodata (M2 input) | `C:\Users\user\Downloads\bustaron_map_data\{GeoJSON,KML}` |
| Git | `main`; M1 `081e985` → M2 `205f696`/`4c663ab` → T2 `3f39ed9`/`ecc9239` → T3 `bb62680` → T4/T5 `33da058`/`e02149e`/`4da43f9` → docs `2349304`/`018d377`/`569b5b9` |

---

## 2. Verification status — ALL GREEN ✅ (T8)

Verified 2026-09-26 ~21:30 after the T8 changes.

| Command (direct binaries via bun) | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 — `index-*.js` 557.37 kB (the 284-zone CAD pack accounts for the size) |
| `eslint . --max-warnings=0` | exit 0 |
| `vitest run` | **71/71 pass** (11 files) |
| `bun scripts/probe_lifecycle.ts` | **28/28 PASS, exit 0** (new T8 headless lifecycle probe) |
| Live preview assertions | disclosure, provider toggle, route polyline, refusal alert, 1440px tier — all verified; console clean |

### ⚠️ IMPORTANT — how to run commands here

**Never `npm install` / `npm run *`.** Call the tools through the bundled bun
directly:

```bash
cd "C:/Users/user/WorkBuddy AI/2026-09-24-21-39-57"
B="C:/Users/user/AppData/Local/Programs/@codebufffreebuff-desktop/resources/bun/bun.exe"
"$B" node_modules/typescript/bin/tsc -b
"$B" node_modules/vite/bin/vite.js build
"$B" node_modules/eslint/bin/eslint.js . --max-warnings=0
"$B" node_modules/vitest/vitest.mjs run
```

Dev/preview servers: `run_terminal_command` BACKGROUND is not implemented —
use detached PowerShell with the full bun path, then `register_preview` with
url + pid (get the pid from `netstat -ano | grep :4173`):

```bash
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath '<full bun.exe path>' -ArgumentList 'node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort' -WorkingDirectory '<project dir>'"
```

**Preview-env note (T8):** the preview browser does not deliver trusted clicks
to the page. Drive interactions through the React props handlers
(`element[Object.keys(el).find(k => k.startsWith('__reactProps$'))].onClick({...})`)
— the same code path a real click executes — then assert store/DOM state.

The 3 `node_modules/**/*.DELETE.*` files are known-harmless leftovers (real
files restored beside them); see §4.1 history.

---

## 3. T8 session changes (this handoff's delta)

| Change | Why | Where |
|---|---|---|
| Mobile nav disclosure | T7-3: at 320px the sidebar consumed the whole first viewport; the map started two screens down | `SidebarNav.tsx`, `globals.css` |
| Map provider toggle + offline-svg default | C6: the Mapbox path renders no tactical overlay, so defaulting to it regressed the PRD landing view | `MapHost.tsx` |
| Desktop toggle-visibility fix | Live inspection caught the shared `.control-button` rule beating the ≥768px media query | `globals.css` |
| Wallet seed invariant | Seed `reservedCredits` did not include escrowed approvals → rejecting could go negative | `mockData.ts` |
| Default demo destination | Central↔Kwun Tong is correctly refused now (see below); Central→Stonecutters is a working pair | `MissionPanel.tsx` |
| Lifecycle probe (NEW) | Headless end-to-end behaviour proof for planner/credits/approvals | `scripts/probe_lifecycle.ts` |
| Harbour diagnostic (NEW) | Documents which transects the harbour RFZ seals | `scripts/probe_harbour.ts` |
| Provider + disclosure tests (NEW/rewritten) | Cover the C6 default and T7-3 contract | `MapHost.test.tsx`, `navDisclosure.test.tsx` |

### Victoria Harbour RFZ seals mid-harbour transits — NOT a bug

With the T2-corrected 284-zone pack, "Victoria Harbour" is itself a CAD RFZ.
With the planner's 60 m margin, every mid-harbour transect is blocked —
Central pier ↔ {Kwun Tong promenade, Lei Yue Mun east} are refused with
`No compliant route found within lattice bounds` (surfaced as `role="alert"`).
The pre-T2 claim "all 42 pairs route" was an artifact of the corrupt rings.
Demo default is now Central pier → Stonecutters west (6.5 km, 10 waypoints);
the refusal is asserted in `scripts/probe_lifecycle.ts` and was verified live.

---

## 4. Environment gotchas (unchanged, still true)

### 4.1 Safe-delete guard leftovers
`find node_modules -name "*.DELETE.*"` → the same 3 files as before. Harmless
because the real files were restored next to them. Symptom if ever broken:
`MODULE_NOT_FOUND` on `http-proxy-agent` inside jsdom — repair by copying each
`.DELETE.` file to its real name.

### 4.2 node_modules is complete — do not reinstall
241 packages. Installed versions drift above declared ranges (tsc 5.9.3,
eslint 9.39.5, vite 5.4.21) — harmless.

### 4.3 Mapbox token
Lives only in gitignored `.env.local` (`VITE_MAPBOX_TOKEN`); the app defaults
to the offline SVG map and the MAPBOX toggle is disabled without it. See
`.env.example`.

---

## 5. Known open defects (PRD-level, deliberately unfixed)

Re-verified against code in T8 (first found in T1):

1. Altitude bands: PRD wants 0–400 m in five bands; slider caps at 220 and the
   store clamps at 250 (`dashboardStore.ts` `setAltitudeBand`).
2. No per-operator drone scoping (`Drone` has no `operatorId`).
3. Sandbox zones treated as no-fly (CAD pack has no kind taxonomy; PRD §5.3
   wants 25 sandbox zones at high cost, not infinite).
4. Approvals have no decision-reason input field (PRD S121).
5. KPI bars don't match PRD (S110/S117: no Credits Balance / ESG / Blockchain
   TPS / Pending Approvals / Active Alerts).
6. `AirspaceZone.kind` cannot represent the sandbox class.

Design-doc drift, still true: MUI and lucide-react never adopted (docs mandate
them — either adopt or amend the docs); `docs/milestone-01.md` nav lists don't
exist in the app; `npm run` has never been executed (C5).

---

## 6. Next steps — resume point

**M3 product work (in priority order):**
1. PRD defects 1–6 above — each is small; 1+4 pair naturally (altitude bands +
   approvals reason), 2+3 need small domain-model extensions.
2. Mapbox overlay migration (zones/drones/routes on the Mapbox path) — the
   provider toggle is a stopgap.
3. M3 backend behind the `DataBackend` seam (`src/services/dataBackend.ts`):
   FastAPI APIs, PoA ledger, LLM agents, server-side persistence (fixes the
   in-memory reload reset).

**Verification ritual for every change (T8-proven):**
`probe_lifecycle.ts` → four gates → live preview assertions → `preview_logs`.

---

## 7. Artifact index (delta)

| Path | What it is |
|---|---|
| `TRACE.md` | Authoritative task log — **§T8 is the newest entry** |
| `docs/vault/` + `Index.md` | Obsidian memory pipeline; newest session note is T8 |
| `scripts/probe_lifecycle.ts` | NEW — headless planner/credits/approvals lifecycle probe (28 checks) |
| `scripts/probe_harbour.ts` | NEW — harbour transect diagnostic |
| `tools/verify-mapbox.mjs` | Programmatic Mapbox render verification (8/8) |
| `tools/check-layout.mjs` | Programmatic responsive layout measurement |
| `VERIFICATION_REPORT.md` | Independent audit of the M1/M2 handoff claims |

## 8. 60-second cold start

```bash
cd "C:/Users/user/WorkBuddy AI/2026-09-24-21-39-57"
B="C:/Users/user/AppData/Local/Programs/@codebufffreebuff-desktop/resources/bun/bun.exe"
find node_modules -name "*.DELETE.*"        # expect the 3 known leftovers
"$B" node_modules/vitest/vitest.mjs run     # expect 71 passed / 11 files
"$B" scripts/probe_lifecycle.ts             # expect ALL CHECKS PASSED
```

Then read **`TRACE.md` §T8** and the newest vault session note.
