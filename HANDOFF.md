# BUSTARON — SESSION HANDOFF

> Purpose: let any new AI/engineer resume **without re-reading the whole project**.
> Last updated: 2026-09-26 16:10 GMT+8 — **M2 complete, gates green.**

---

## 1. Project identity

| Item | Value |
|---|---|
| Product | **BUSTARON v3** — Hong Kong drone airspace / UTM operations platform |
| Active workspace | `C:\Users\user\WorkBuddy AI\2026-09-24-21-39-57` |
| Stack | Vite 5.4.21 + React 18 + TypeScript 5.9.3 + Zustand 4 + Tailwind 3 + Vitest 2.1.9 |
| Current milestone | **M2 — Planning + data adapters. DONE & VERIFIED.** M1 shell verified beneath it. |
| Source of truth PRD | `C:\Users\user\WorkBuddy AI\2026-09-20-21-42-04\BUSTARON_PRD.md` (58 KB) |
| Geodata (M2 input) | `C:\Users\user\Downloads\bustaron_map_data\{GeoJSON,KML}` |
| Extra refs | `C:\Users\user\WorkBuddy AI\2026-09-20-21-42-04\` — `landsd_data/`, `orbitron_js_bundle.js`, `ui_inspect/`, `decentralized_deck.txt`, `proof_carrying_drone.txt` |
| Git | **IS a git repo now.** `main`, M1 baseline commit `081e985` + M2 commit. |

---

## 2. Verification status — ALL GREEN ✅ (M2)

Verified 2026-09-26 16:07 after the M2 build.

| Command | Result |
|---|---|
| `tsc -b` | exit 0 |
| `vite build` | exit 0 — `dist/assets/index-yjz_CzkM.js` 407.92 kB (CAD zone pack bundled), CSS 13.42 kB |
| `eslint . --max-warnings=0` | exit 0, zero warnings |
| `vitest run` | **47/47 tests pass** (6 files: M1 shell regression + geo/A*/credits/CAD/UI flows) |

M1 acceptance criteria from `docs/system_design.md` §2 are all met.

### ⚠️ IMPORTANT — how to run commands here
`npm run build|test|lint` is **extremely slow** (3–5 min) because `package.json` scripts use `npm exec --package ...`, which re-resolves the registry on every run. **Bypass it and call local binaries directly:**

```bash
cd "C:/Users/user/WorkBuddy AI/2026-09-24-21-39-57"
B="C:/Users/user/AppData/Local/Programs/@codebufffreebuff-desktop/resources/bun/bun.exe"
"$B" node_modules/typescript/bin/tsc -b
"$B" node_modules/vite/bin/vite.js build
"$B" node_modules/eslint/bin/eslint.js . --max-warnings=0
"$B" node_modules/vitest/vitest.mjs run
"$B" node_modules/vite/bin/vite.js --host 0.0.0.0        # dev server
```

**There is NO Node.js on this machine.** The `node_modules/.bin` shims exec
`node`, which is not on PATH. The runtime available here is the Freebuff
desktop's bundled **bun 1.4.2** at the path above — run each tool's JS entry
point through it directly (see the commands). Verified working: tsc, vite,
eslint, vitest.
Typical direct-binary timings: tsc <10 s, vite build ~19–45 s, vitest ~13–35 s.
**Do not run `npm install`** — `node_modules` is already complete (241 packages). A re-install triggers the destructive guard described in §4.

---

## 3. What was built (M1)

A mock-only, dark-theme tactical operations SPA. No backend, no map API, no blockchain.

**Source files — 20 files, 1,760 lines total:**

| File | LOC | Role |
|---|---|---|
| `src/types/domain.ts` | 91 | Domain model: Drone, Mission, AirspaceZone, WeatherAlert, Metric, UserRole, NavSection, LayerId, altitude bands |
| `src/data/mockData.ts` | 231 | Realistic HK mock data (Victoria Harbour, drones, routes, RFZ, weather, layer definitions) |
| `src/services/mockDataService.ts` | 47 | `loadInitialState()`, `simulateTick()` — the mock→real seam for M2 |
| `src/store/dashboardStore.ts` | 102 | Zustand store: role, active section, selected drone, layer flags, altitude band, emergency state |
| `src/components/layout/AppShell.tsx` | 84 | Shell composition + operator/admin metric rows |
| `src/components/layout/SidebarNav.tsx` | 76 | Operator (8) + Admin (10) nav entries, `aria-current` |
| `src/components/layout/TopBar.tsx` | 75 | Role switch, emergency hold, new flight |
| `src/components/map/TacticalMap.tsx` | 125 | Schematic 2D HK map (hand-rolled SVG, no external tiles) |
| `src/components/map/DroneMarker.tsx` | 33 | Selectable drone marker |
| `src/components/map/MapLayerControls.tsx` | 27 | Layer toggles, `role="group"`, `aria-pressed` |
| `src/components/panels/StatusPanel.tsx` | 69 | Live status / selected drone |
| `src/components/panels/MissionPanel.tsx` | 85 | Mission preview |
| `src/components/panels/AdminPanel.tsx` | 68 | Approvals, blockchain audit, counter-drone posture |
| `src/components/common/MetricCard.tsx` | 33 | Reusable metric card |
| `src/components/common/EmptyState.tsx` | 19 | Reusable empty state |
| `src/styles/globals.css` | 537 | Dark tactical theme, responsive 320/768/1024/1440, focus states |
| `src/App.tsx` / `src/main.tsx` | 5 / 16 | Entry |
| `src/test/App.test.tsx` / `setup.ts` | 36 / 1 | 3 component tests |

**Config:** `package.json`, `index.html`, `vite.config.ts`, `tsconfig{,.app,.node}.json`, `eslint.config.js`, `tailwind.config.ts`, `postcss.config.js`.

**Key product decision honored:** PRD requires **2D map as the landing view**; 3D/Cesium is hidden behind a nav tab, not the default.

---

## 4. Environment gotchas (READ BEFORE DEBUGGING)

### 4.1 Safe-delete guard corrupts `node_modules` (FIXED, but may recur)
The host's file-operation guard intercepts npm's delete step and renames files to `*.DELETE.<hash>` instead of removing them. On 2026-09-24 this broke the install mid-flight, and it left **3 files with missing `.js` entries**, which made every `vitest` run die with `Cannot find module ... http-proxy-agent\dist\index.js`.

**Detect:**
```bash
find node_modules -name "*.DELETE.*"
```
**Repair** (restores the file under its real name; the `.DELETE.` original can stay):
```bash
cd "C:/Users/user/WorkBuddy AI/2026-09-24-21-39-57"
for f in $(find node_modules -name "*.DELETE.*"); do cp "$f" "${f%%.DELETE.*}"; done
```
Files repaired this session:
- `node_modules/agent-base/dist/index.js`
- `node_modules/http-proxy-agent/dist/index.js`
- `node_modules/https-proxy-agent/dist/index.js`

Symptom to recognize: `MODULE_NOT_FOUND` on `http-proxy-agent` / `https-proxy-agent` / `agent-base` inside `jsdom`. It is **not** a source-code bug.

### 4.2 `node_modules` is complete — do not reinstall
241 packages, all of `vite typescript vitest jsdom react zustand eslint tailwindcss @vitejs/plugin-react @testing-library/react` present. Note installed versions drift above the declared ranges (typescript 5.9.3 vs `^5.6.3`, eslint 9.39.5 vs `^9.17.0`, vite 5.4.21 vs `^5.4.11`) — harmless, but pin them if reproducibility matters.

### 4.3 Stale file
`vite.config.ts.timestamp-1790259748782-13c4802b40a4.mjs` is a leftover vite temp file at project root. Safe to delete.

### 4.4 No git
There is no repository, so there is **no rollback safety net**. Consider `git init` + initial commit before starting M2.

---

## 5. Bugs found and fixed this session

1. **Test infra dead** — jsdom could not load because of the 3 missing files above. Fixed by restoring them (§4.1). Before: `Test Files no tests / Errors 1 error`. After: 3/3 pass.
2. **Ambiguous test query** — `src/test/App.test.tsx:12` used `screen.getByRole('button', { name: /routes/i })`, which matched **two** elements: the map layer toggle "Routes" and the sidebar "Approvals Queue" nav item (whose description text is *"Mock requests and routes"*). Testing Library strict mode threw. Fixed by:
   - `src/components/map/MapLayerControls.tsx:11` — added `role="group"` to the controls container (also a genuine a11y improvement for a toggle group).
   - `src/test/App.test.tsx` — import `within`, then scope all four layer assertions to `within(screen.getByRole('group', { name: /map layer controls/i }))`.

---

## 6. Next steps — resume point

**Immediate (finish M1 cleanup, ~5 min):**
1. Optionally run the dev server once (`./node_modules/.bin/vite --host 0.0.0.0`) and eyeball the operator dashboard + admin switch in a browser. No functional risk — build and tests already pass.
2. `git init && git add -A && git commit` to establish a baseline.
3. Delete the stale `vite.config.ts.timestamp-*.mjs`.

## 6. Next steps — resume point (M3)

M1 and M2 are both committed. M2 scope (per `docs/system_design.md` §1) is
complete: adapter boundary, CAD GeoJSON ingestion (135 RFZ zones), RFZ
point-in-polygon + buffers, A* lattice route planning, credits/auction service
and UI (Credit Wallet, Approvals Queue). Details and file inventory:
`docs/milestone-02.md`.

**Next: M3 — Backend, ledger, agents** (per `docs/system_design.md` §1):
- FastAPI APIs (the frontend adapters in `src/services/dataBackends.ts` are the
  exact seam — implement HTTP backends behind the same `DataBackend` interface).
- Python LLM-agent negotiation, 3-node PoA ledger, blockchain-as-communication.
- Persist auctions/approvals server-side (frontend state is in-memory today).

Follow-ups noted in `docs/milestone-02.md` §Known follow-ups. The 2D map stays
the landing view; 3D/Cesium remains behind a nav tab for M4.

Later milestones, unchanged: M4 ESP32-S3 firmware + CesiumJS HK 3D demo · M5 ops platform (fleet, logs, maintenance, customer portal, exports) · M6 BVLOS + E2E hardening.

---

## 7. Artifact index

| Path | What it is |
|---|---|
| `HANDOFF.md` | **← this file.** Start here. |
| `overview.md` | M1 work overview — ⚠️ **its "verification blocked" section is STALE** (written 22:05, before install finished at 22:22). Superseded by §2 above. |
| `docs/system_design.md` | Authoritative M1–M6 roadmap, architecture, acceptance criteria, file list, data models |
| `docs/milestone-01.md` | M1 explainer: what/why/how/scope — ⚠️ same stale verification note at its end |
| `docs/class-diagram.mermaid` | Domain class diagram |
| `docs/sequence-diagram.mermaid` | Runtime sequence diagram |
| `dist/` | Production build output (verified fresh) |
| `docs/milestone-02.md` | M2 explainer: adapters, ingestion, A*, credits, verification |
| `scripts/generate_cad_data.py` | One-shot generator that compacted the CAD GeoJSON into `src/data/cadRfzData.json` |
| `.workbuddy-ai/memory/2026-09-24.md` | Session work log |
| `.workbuddy-ai/memory/2026-09-26.md` | Session work log (this session) |

Team state: agent team `software-bustaron` was created with roles `software-architect` and `software-engineer`; the M1 build was executed by those roles. No tasks are in flight.

---

## 8. 60-second cold start

```bash
cd "C:/Users/user/WorkBuddy AI/2026-09-24-21-39-57"
find node_modules -name "*.DELETE.*"        # must print nothing; if not, run §4.1 repair
./node_modules/.bin/vitest run              # expect 3 passed
./node_modules/.bin/vite build              # expect exit 0
# read docs/system_design.md §1 for the M2 scope, then start there
```
