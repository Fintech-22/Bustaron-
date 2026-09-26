# BUSTARON v3 — Independent Verification Audit

**Target:** `8a584fc` on `main` (no remote) · **Audited:** 2026-09-27
**Method:** read-only. Every verdict below is backed by a command that was actually run or a `file:line` that was actually read. No source file was modified and no commit was made.
**Team:** `software-bustaron-verify` — lead (orchestration + independent cross-checks) + `software-qa-engineer` (WS-A frontend/defects), `software-engineer` (WS-B1/C1 Mapbox + credits), `software-architect` (WS-C2/C3 backend + seam), `software-product-manager` (WS-D PRD S1–S129).

Per-workstream raw evidence (read-only, gitignored):
`.workbuddy-ai/verification/ws-a-frontend-and-defects.md` · `ws-b1-c1-mapbox-and-credits.md` · `ws-c2-c3-backend-and-seam.md` · `ws-d-prd-conformance.md`

---

## 1. Baseline — the four gates

All four gates were re-run on a cleaned tree at the end of the audit. **All green.**

| Gate | Command (via bundled bun — `npm` is banned) | Result |
|---|---|---|
| 1 TypeScript | `node_modules/typescript/bin/tsc -b` | **exit 0** |
| 2 Build | `node_modules/vite/bin/vite.js build` | **exit 0** (76 modules; `index-DsWAiCKN.js` 571 kB / 188 kB gzip) |
| 3 Lint | `node_modules/eslint/bin/eslint.js . --max-warnings=0` | **exit 0** |
| 4 Tests | `node_modules/vitest/vitest.mjs run` | **exit 0 — 93/93 across 14 files** |

> **Lint caveat (important):** `eslint .` also walks `.workbuddy-ai/`. During the audit, auditor scratch `.mjs`/`.ts` files there produced 33 errors. Those are gitignored audit residue, **not** product code — the product source is clean (`eslint src` → exit 0). All scratch files were removed and the gate re-run clean. See §6.

---

## 2. Probes — claimed vs actual

| Probe | Brief claimed | **Actual** | Verdict |
|---|---|---|---|
| `vitest run` | 93/93, 14 files | 93/93, 14 files | ✅ confirmed |
| `bun scripts/probe_lifecycle.ts` | **36/36** | **38/38** | ⚠️ **claim stale (understated)** — source has exactly 38 `assert()` calls |
| `python server/probe_api.py` | 22/22 | **22/22 from a pristine seed**, but **21/22 on a repeat run** | ⚠️ **non-idempotent** (see §3.3) |
| `bun scripts/probe_m3_seam.ts` | 7/7 | 7/7 | ✅ confirmed |
| `bun scripts/probe_routes.ts` | 42/42 | **42/42, 0 failures** | ✅ confirmed |

`probe_routes` deserves a note: `TRACE.md` T8 claims **38/42** and calls the 4 Victoria Harbour refusals a feature. That is **superseded** — T10/T11 reclassified the harbour sandbox so Central↔Kwun Tong routes again. The brief's 42/42 is correct; the TRACE note is the stale one.

---

## 3. Claim-by-claim verdicts (handover brief §2)

### 3.1 Frontend shell, responsive, a11y — all CONFIRMED

| Claim | Verdict | Evidence |
|---|---|---|
| Dark tactical shell; 2D is the landing view for both roles | **CONFIRMED** | `globals.css:20-38` dark palette; `AppShell.tsx:94`; `dashboardStore.ts:87-88` defaults `activeSection:'operations'`. Grep for `3D\|cesium\|three\|pitch` in `src` → **no 3D view exists**, so 3D cannot be the landing view. *Caveat:* an admin **role-switch** lands on the Admin panel, not the map (`dashboardStore.ts:118-128`) — the role-agnostic default is still the map. |
| Operator/Admin role switching | **CONFIRMED** | `TopBar.tsx:81-97` (`aria-pressed`), `AppShell.tsx:34,77`, `dashboardStore.ts:118-128`; test `App.test.tsx:35-43` |
| Mobile nav disclosure <768px | **CONFIRMED** | `SidebarNav.tsx:78-87` `aria-expanded`/`aria-controls`, collapse-on-navigate `:101-104`; `globals.css:205-219`; `navDisclosure.test.tsx` 3/3 |
| WCAG-AA focus rings | **CONFIRMED** | `globals.css:141-145` `:focus-visible` + tokens `:94-96` |
| `role="alert"`/`role="status"` | **CONFIRMED** | `EmptyState.tsx:50-52`; `ApprovalsQueuePanel.tsx:68,87`; `MissionPanel.tsx:82,108` |
| Token system; breakpoints 768/1024/1440; legacy gone | **CONFIRMED** | `globals.css:41-74` tokens; media queries at `:872 / :920 / :964` (independently confirmed: exactly 5 `@media`, only `prefers-reduced-motion` besides); **zero** `1180/860/560` in CSS |
| Map container NOT `role="img"` | **CONFIRMED** | `TacticalMap.tsx:74-85` container `role="group"`, inner SVG `role="img"`; `uiA11y.test.tsx:25-34` |

### 3.2 Mapbox overlay + skycells

| Claim | Verdict | Evidence |
|---|---|---|
| Mapbox is primary with the full tactical overlay | **CONFIRMED** | Layer stack contains `rfz-fill/line`, `weather-fill/line`, `mission-line`, `planned-line`, `drone-arrow/dot/label`, `skycell-fill/line`. Live puppeteer probe on the **CAD** source: `rfz-zones` source = **284 features**, rendered **134 fill / 135 line**, with real names (`Cape Collinson (Low-altitude Economy Regulatory Sandbox)`, `Chai Wan Police Station`, …). Console errors = **0**. `tools/verify-mapbox.mjs` → **8/8**. |
| **462** deterministic ~600 m skycells | ❌ **REFUTED** | `SKYCELL_SIZE_M = 600` ✅, determinism ✅, occupancy banding ✅ — but the lattice is **594 cells**, not 462. Computed directly (`buildSkycells` over `HK_BOUNDS` = 22.255–22.37 / 114.095–114.25 → 22×27) and confirmed live: `skycells` source = **594**. The 462 figure is almost certainly a **viewport-clipped** `queryRenderedFeatures` count from T9, mis-recorded as the lattice size. |
| Layer toggles + altitude-band filter drive BOTH providers from store flags | **CONFIRMED** | Single `dashboardStore` source of truth; both `MapboxMap` and `TacticalMap` subscribe to the same flags |
| Offline SVG fallback intact | **CONFIRMED** | `TacticalMap.tsx`; `MapHost` selects `offline-svg` when no token |
| "110 restricted RFZ polygons render" | ⚠️ **PARTIAL / imprecise** | Overlay rendering is real and confirmed, but the number is **viewport- and zoom-dependent**: at 1440×900 / zoom 11.2 the CAD source renders **134 fill / 135 line** polygons, not 110. Treat 110 as a stale snapshot, not a fact. |
| Zone hover/click metadata popups (PRD S103) | **NOT MET** (brief §5 already admits this) | No popup layer; `queryRenderedFeatures` is used for **selection**, not metadata display |

### 3.3 Credits / auctions engine

| Claim | Verdict | Evidence |
|---|---|---|
| Escrow on bid | **CONFIRMED** | `creditsService.ts:50+`; probe `bid: escrow moves 90 credits…` |
| Reserve enforcement | **CONFIRMED** | probe `bid: below reserve rejected with surfaced error` |
| Award releases losers | **CONFIRMED** | probe `award: losing bidder refunded…` ×2 |
| **Settle** transfers to corridor owner | ⚠️ **CONFIRMED AT SERVICE LEVEL — NOT WIRED** | `settleAuction` (`creditsService.ts:176`) is referenced **only** by `creditsService.test.ts` and `probe_lifecycle.ts` — **no store action, no UI path**. The probe itself admits it (`probe_lifecycle.ts:106`: *"settleAuction is service-level (store has no settle action yet)"*). The engine works; the app can never reach it. |
| Approval escrow burned on approve / refunded on reject | **CONFIRMED** | probe `approve: escrow burned…`, `reject: 80-credit escrow refunded…` |
| Full ledger of every mutation | ⚠️ **PARTIAL** | Ledger rows are produced for **award** (`:146`), **settle** (`:208`) and **approval decision** (`:279`). `placeBid` and `fileApprovalRequest` emit **no** ledger row. |

### 3.4 The six PRD defects — all genuinely fixed

| Defect | Verdict | Evidence |
|---|---|---|
| 1 — altitude bands 0–400 m, clamp removed, inclusive edges | **CONFIRMED** | `altitudeBands.ts:7-13,23-29`; `dashboardStore.ts:144-149` `Math.min(400,…)`; no `Math.min(250` in `src`. *Caveat:* a **vestigial** `min=80 max=220` "Shared altitude ceiling" slider survives at `MissionPanel.tsx:128-139` driving `altitudeBandM`, which is **display-only** — dead UI that can mislead. |
| 2 — per-operator scoping | **CONFIRMED** | `domain.ts:23-24` `operatorId`; filter `TacticalMap.tsx:141-144` / `MapboxMap.tsx:209-212`; impersonation select `TopBar.tsx:66-79`. Live: operator sees **2 of 4** drones. |
| 3 — sandbox ×2.5, not blocking | **CONFIRMED** | `routePlanner.ts:155-167,339-344`; `zoneClassification.ts:12` `SANDBOX_COST_FACTOR = 2.5` |
| 4 — rejection requires a reason | **CONFIRMED** | `creditsService.ts:264-267`; UI guard `ApprovalsQueuePanel.tsx:26-29,79` |
| 5 — role-based KPI bars | ⚠️ **PARTIAL** | Slot set and order match for both roles, but **7 of 8 labels differ by casing**: the app renders sentence case (`Active drones`, `Credits balance`, `ESG score`, `Pending alerts`, `City risk score`, `Pending approvals`) while the claim quotes Title Case (`Active Drones`, …). `Blockchain TPS` matches exactly. Whether this fails PRD S110/S117 depends on how literally you read the label text — **cosmetic, trivially fixable, but the claim as written is not literally true.** |
| 6 — `kind` includes `'sandbox'`; 24 sandbox / 260 rfz of 284 | **CONFIRMED** | `domain.ts:59`; `cadGeoJsonService.ts:57-62`. Independently counted from the data file: **284 total, 24 sandbox-named, 260 restricted**. |

### 3.5 M3 backend

| Claim | Verdict | Evidence |
|---|---|---|
| Hash-chained append-only ledger (`prev_hash` + sha256) | **CONFIRMED** | `main.py:101-113`; genesis `prev_hash` = 64 zeros |
| `GET /chain`, `/block/{height}`, `chainValid` recomputed every read | **CONFIRMED** | `main.py:246,252`; `verify_chain` re-hashes on every read |
| Tamper → `chainValid` false | **CONFIRMED** (independently reproduced) | Corrupted `blocks[1].txs`, restarted, `chainValid=false` |
| `state.json` atomic writes + seed-on-boot + restart survival | **CONFIRMED** | `save_state` writes `.json.tmp` then `os.replace` (`main.py:94-98`); probe `state survives restart` |
| `POST /chain/tx` for BID / AWARD / APPROVAL_DECIDE, client-parity, 422/409 | **CONFIRMED** | `main.py:280-301`; probe asserts 422 reserve, 422 reason, 409 double-decision |
| **`GENESIS` via `POST /chain/tx`** | ⚠️ **PARTIAL** | `GENESIS` is **not** an accepted tx type on the endpoint — it is created by `seed_if_empty` (`main.py:203`). The endpoint returns **400** for it. The brief's phrasing implies otherwise. |
| All read endpoints respond | ⚠️ **PARTIAL** | All 8 routes exist and return 200. But **`/api/fleet`, `/api/missions`, `/api/ledger` return empty arrays** — `state.drones`/`state.missions` are never seeded or written, and `M3Backend.loadFleet/loadMissions` return **mock** data instead (`m3Backend.ts:168-178`). The endpoints are structurally present but functionally vacuous. |
| CORS restricted to localhost/127.0.0.1 | **CONFIRMED** | `allow_origin_regex=r"^https?://(127\.0\.0\.1\|localhost)(:\d+)?$"` (`main.py:40`) — **not** `*` |

### 3.6 M3 frontend seam

| Claim | Verdict | Evidence |
|---|---|---|
| `M3Backend` (`m3-server`) implements `DataBackend` | **CONFIRMED** | `src/services/m3Backend.ts`; `probe_m3_seam.ts` 7/7 |
| Optional async `hydrate()` on `DataBackend` | **CONFIRMED** | `src/services/dataBackend.ts` |
| Graceful offline fallback | **CONFIRMED** | Fetch failure falls back to CAD composition |
| `setBackend` applies hydration async | **CONFIRMED** | `dashboardStore.ts:172+` |
| Source picker offers M3 server | **CONFIRMED** | Live: picker shows `Mock replay (offline demo)` / `CAD RFZ GeoJSON (284 zones)` / `M3 FastAPI server` |
| **"The store never imports data modules directly"** (§4 architectural claim) | ❌ **REFUTED** | `dashboardStore.ts:2` imports `layerDefinitions` from `../data/mockData`. One direct import; the architectural claim is overstated. |

---

## 4. Discrepancies found — the headline list

1. **Skycell count is 594, not 462.** The lattice size is derived from `HK_BOUNDS` × 600 m. Both the brief and TRACE T9 say 462; the 462 figure was a viewport-clipped render count, not the lattice.
2. **`probe_lifecycle` is 38 checks, not 36.** Source contains exactly 38 `assert()` calls; the brief and TRACE T11 both understate it.
3. **`probe_api` is non-idempotent.** It scores **22/22 from a pristine seed** but the first 12 checks hardcode absolute seed balances (harbour 480/40, urban 260/80) and the probe only re-seeds *after* them. A **second consecutive run** fails — the architect measured **21/22 twice**; against a differently-shaped residual state I measured **2 failures**. Root cause is the same in both cases: *the probe does not re-seed before its first section*. The **product behaviour is correct**; the **probe is not repeatable**, and "22/22" is only true on a clean `state.json`. **Recommended fix: `STATE_PATH.unlink()` + restart at the top of the probe.**
4. **286 vs 284 zones — ADJUDICATED, and the code is right.** Raw `map.geojson` = **286** features (**25** sandbox-named); the shipped pack = **284** (**24** sandbox). The generator drops features only when **name *and* ring-geometry hash** are identical (`generate_cad_data.py:130-160`). The two dropped are byte-identical duplicates: `Kam Tin River (Low-altitude Economy Regulatory Sandbox)` and `Shek Kong Village`. So **284/260/24 is the correct distinct-zone count** and the PRD's 286/261/25 counts raw duplicates. Strictly against the PRD's letter S98/S101 are NOT MET, but the inconsistency is **in the PRD**, not the code.
5. **"110 restricted RFZ polygons"** is viewport/zoom-dependent; measured **134 fill / 135 line** at 1440×900. Overlay rendering itself is confirmed real.
6. **`AUCTION_SETTLE` is advertised but unimplemented.** It is declared in `TXType` (`main.py:53`) but has **no dispatch branch**, so `POST /chain/tx` with it falls to the `else` → **HTTP 400**. A type advertised by the API contract is rejected at runtime.
7. **`server-side fleet/missions`** in the brief's gap list is imprecise: the **endpoints exist**; the **data is empty and never seeded**, and the frontend returns mock data anyway.
8. **`settleAuction` is service-only** — reachable from tests and the probe, never from the UI.
9. **Audit-harness reproducibility:** the PowerShell tool **reaps child processes** when a tool call returns, so an API server launched in one call is dead by the next. The server must be launched **and** probed inside a single shell invocation. (Discovered and worked around; recorded so the next session doesn't lose time to it.)

---

## 5. PRD conformance (S1–S129)

Built criterion-by-criterion by the PM. **Verdict distribution:**

| Verdict | Count | Share |
|---|---|---|
| **MET** | **7** | 5.4 % |
| **PARTIAL** | **18** | 14.0 % |
| **NOT MET** | **39** | 30.2 % |
| **NOT ATTEMPTED** | **63** | 48.8 % |
| **UNVERIFIED** | **2** | 1.6 % |
| **Total** | **129** | 100 % |

- **MET:** S2, S105, S107, S109, S110, S116, S121
- **UNVERIFIED:** S92 (no unhandled exceptions across an E2E run), S102 (the <10 ms PIP budget — ray-casting exists but there is **no timing evidence anywhere**)
- **PARTIAL:** S1, S4, S6, S16, S41, S42, S44, S47, S93, S95, S100, S104, S106, S108, S113, S114, S117, S118

**Web-dashboard criteria (S104–S129) — the most relevant to this milestone:**

| | MET | PARTIAL | NOT MET | NOT ATTEMPTED |
|---|---|---|---|---|
| Operator (S104–S115) | S105, S107, S109, S110 | S104, S106, S108, S113, S114 | S111, S112, S115 | — |
| Admin (S116–S125) | S116, S121 | S117, S118 | S119, S120, S122, S123, S124, S125 | — |
| 3D tab (S126–S129) | — | — | — | S126–S129 |

Honest reading: **everything that is built is built well** (93 tests green, 38/38 lifecycle, 42/42 routes, 22/22 API, clean lint, real Mapbox overlay). **Everything missing is missing at the milestone level** — not half-faked. But only **7 of 129** criteria are fully met, and the brief's §5 gap list is **incomplete** (see below).

### Gap-list inaccuracies (brief §5)
- **"server-side fleet/missions"** — endpoints exist, data does not (see §3.5).
- **Omitted, in-scope, and unmet:** **S91** no pytest suite exists at all (and it demands ≥60 tests) · **S94** **no README anywhere** · **S98/S99** no `data/rfz_landsd.geojson` and no merged dataset · **S111/S120** sidebar is missing **6 of 8** operator and **8 of 10** admin entries · **S104/S126–S129** **there is no "3D View" tab at all** (so S104 is only half-satisfied) · **S93 (Python half)** no ruff/flake8 · **S95** `.env.example` documents only `VITE_MAPBOX_TOKEN` (not `VITE_M3_API_URL`, `BUSTARON_DATA_DIR`).
- **Milestone-attribution conflict:** `TRACE.md` T11 lists ESP32 under **M3**, `.workbuddy-ai/memory/MEMORY.md:8` puts it at **M4**. The two docs disagree.
- **Doc reference error:** the brief's reading list cites `docs/milestone-03.md`; **it does not exist** (only `milestone-01.md`, `milestone-02.md`).

---

## 6. Limits of this audit — what I did NOT verify

- **PRD text literals.** The PRD is outside the repo. Where a claim is about an exact string (e.g. KPI label casing) I compared against the strings *quoted in the brief*, not the PRD itself.
- **S92** (no unhandled exceptions in a full E2E run) — no E2E harness exists to exercise it.
- **The CAD-path "110" exact figure** — I measured 134/135 at one viewport; other viewports will differ. The *mechanism* is confirmed.
- **Vision.** No claim in this report rests on an image I did not receive. Live UI evidence was obtained **programmatically** (puppeteer + `window.__bustaronMap` + `queryRenderedFeatures`), which is stronger than a screenshot anyway.
- **Lint on a dirty tree.** `eslint .` is only green once audit scratch under `.workbuddy-ai/verification/` is removed. It was green at baseline and is green again now.

**Tree state after the audit:** clean — `git status` shows only the pre-existing untracked `server/__pycache__/` and `server/data/`. The modified `screenshots/_canvas_only.png` (touched by the Mapbox verifier) was restored. No commit was made.

---

## 7. Recommended next steps (for your review — nothing implemented)

Ordered by value-per-effort. **Awaiting your go-ahead.**

1. **Fix the three probe/doc inaccuracies** (low effort, high trust value): re-seed at the top of `probe_api.py`; correct "36/36" → "38/38" and "462" → "594" in the brief/TRACE; append a TRACE correction note rather than rewriting history.
2. **Close the API-contract wart:** either implement `AUCTION_SETTLE` in `submit_tx` or remove it from `TXType` — an advertised-but-400 type is a trap.
3. **Decide the fate of `settleAuction`:** wire it to a store action + UI, or mark it explicitly as service-only in the docs.
4. **Decide on the vestigial altitude slider** (`MissionPanel.tsx:128-139`, `min=80 max=220`): remove it, or wire it to the real filter. It currently misleads.
5. **KPI label casing** (S110/S117): pick one convention and make claim and code agree.
6. **Add the missing repo hygiene items** the PRD demands: a README (S94), a pytest suite (S91), ruff/flake8 (S93), a complete `.env.example` (S95).
7. **Reconcile the docs:** the ESP32 milestone attribution, and the phantom `docs/milestone-03.md` reference.
8. **Then** resume the real M3→M6 roadmap (LLM negotiation §8, 3-of-3 PoA §9, `/events` S6, HKO poller §5.2, ESP32/Cesium M4).
