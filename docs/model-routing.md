# Model routing policy — BUSTARON

> Why this file exists: this project is built across multiple AI sessions with different
> capabilities. The lead agent in the 2026-09-26 session could **not** read images
> (image reads returned "content filtered"), which silently blocked visual verification of
> the UI. That failure mode must not recur.

## The rule

| Task type | Model | Why |
|---|---|---|
| **Interpreting pixels** — screenshot review, visual regression, layout/alignment checks, reading diagrams, charts, or scanned/image PDFs | **DeepSeek-V4.1 Flash** | It accepts image input. The default model returns "content filtered" for image reads, so any visual claim made on it is unverifiable. |
| Text, code, tests, logs, git, data analysis, planning, drift reports | **Default model** | Stronger at long-context reasoning and code edits. Switching gains nothing without pixels. |

**One-line heuristic:** if the correct answer depends on *what something looks like*, switch
to Flash. If it depends on *what something says*, stay on the default.

## When to switch to DeepSeek-V4.1 Flash

Switch **before** starting the task, not after failing on it:

1. **Screenshot verification** — the whole `screenshots/**` workflow in this repo.
   A text-only agent can capture PNGs and count console errors, but cannot confirm the
   map rendered, the layout didn't overflow, or the focus ring is visible.
2. **Visual regression** — comparing a before/after pair of PNGs.
3. **Diagram / chart reading** — `.mermaid` renders, dashboards, plots, any figure where
   the *shape* of the data matters.
4. **Scanned or image-only PDFs** — the PRD pack and any regulatory documents supplied
   as images rather than text.
5. **UI layout debugging** — "why does this panel overlap at 768px" is a pixel question.

## When NOT to switch

- Pure code work: refactors, type fixes, writing tests, wiring services.
- Reading text: markdown, JSON, TypeScript, logs, `git log`.
- Data analysis where the numbers are already extracted (the CAD containment audit, for
  instance, is pure arithmetic — Flash adds nothing).
- Anything already proven programmatically. See below.

## Prefer programmatic checks over vision wherever possible

Vision is a fallback, not the first choice. In this repo, verify UI **programmatically**
and reserve the vision model for what genuinely cannot be asserted in code:

| Question | Programmatic answer | Needs vision? |
|---|---|---|
| Did the map tiles load? | Count HTTP 200 responses to `api.mapbox.com` | No |
| Is the canvas non-blank? | Canvas-only screenshot file size (blank < 5 KB) | No — proxy only |
| Are there runtime errors? | Puppeteer `pageerror` / `console` capture | No |
| Is the container the right size? | `boundingBox()` / `getBoundingClientRect()` | No |
| Are the right ARIA roles present? | DOM queries | No |
| **Does the map actually look like Hong Kong?** | — | **Yes** |
| **Does the layout overlap or clip?** | Partially (overflow checks) | **Yes** |
| **Is the focus ring visibly discernible?** | — | **Yes** |

Existing harnesses (no npm install required, run via bun):
- `tools/screenshot.mjs` — captures viewports + interaction states, writes `manifest.json`
  with a `consoleErrors` array.
- `tools/verify-mapbox.mjs` — asserts provider, SDK global, canvas size, tile HTTP status,
  401 count, and canvas-detail size proxy.

> ⚠️ `gl.readPixels()` is **not** a valid blank-canvas check here: Mapbox does not set
> `preserveDrawingBuffer`, so the drawing buffer is cleared each frame and readPixels
> returns blank even on a correct render. Use the canvas-only screenshot size instead.

## Handoff protocol for visual verification

Visual checks are **deferred, not skipped**. Because screenshots are written to disk with
a machine-readable manifest, a vision-capable session can complete the review without
re-running anything:

```bash
# 1. In a DeepSeek-V4.1 Flash session, read the manifest first:
#    screenshots/<timestamp>-<tag>/manifest.json   ← check consoleErrors
# 2. Then read the PNGs directly (Read tool accepts image paths).
```

### Outstanding visual checks (open as of 2026-09-26)

| File | Question to answer |
|---|---|
| `screenshots/2026-09-26T10-01-41-step3-mapbox-fixed/01-operator-desktop-1440.png` | Does the Mapbox dark-v11 Hong Kong base map actually render (coastline, roads, labels)? Is the `MAPBOX` badge present? |
| `screenshots/2026-09-26T10-01-41-step3-mapbox-fixed/02-admin.png` | Does the admin section render without overlap or clipping? |
| `screenshots/2026-09-26T10-01-41-step3-mapbox-fixed/01-operator-mobile-320.png` | At 320px, is anything overflowing horizontally or unreadable? |
| `screenshots/_canvas_only.png` | Sanity check that the map canvas is genuinely non-blank. |
| `screenshots/2026-09-26T09-41-51-step2-verify/04-layers-off.png` | With all layers off, are RFZ polygons correctly absent? |

## Session note (2026-09-26) — vision was unavailable, then became available

Early in this session, image reads returned **"content filtered"** and the lead agent
could not see screenshots. It then wrongly described screenshots it had never seen. That
was the failure this document exists to prevent.

**Mid-session, vision started working** — the same `Read` call on a PNG returned the
actual image. Confirmed by reading `screenshots/_canvas_only.png` and describing verifiable
details (the "Hong Kong" label, Tai Mo Shan Country Park, Tseung Kwan O, the
Mapbox/OpenStreetMap attribution) that could only come from the pixels.

Practical consequences:

1. **Test vision on the first image read of every session.** Do not assume it works, and
   do not assume it is broken. Read one image, check whether you actually received it, and
   state which it is.
2. **If vision is unavailable, say so plainly.** Never narrate an image you did not
   receive. Defer the check to a vision-capable session instead — the handoff list below
   is designed for exactly that.
3. **Vision earned its keep immediately.** On first use it caught a real regression that
   every programmatic check had passed: the "OPERATOR ACTION STATE" heading and the
   "New Flight" button were both wrapping onto two lines at 1440px. `tsc`, `eslint`,
   `vite build`, and 56/56 tests were all green while the UI looked visibly worse.
   **This is the argument for using a vision model: it catches the class of defect that
   green gates cannot.**

### Verification log from the first vision-enabled pass

| Check | How | Result |
|---|---|---|
| Mapbox base map renders Hong Kong | Read `_canvas_only.png` | ✅ coastline, roads, place labels, attribution |
| Wrap regression at 1440px | Read desktop PNG | ❌ found → fixed with `flex-wrap` + `white-space: nowrap` |
| Mobile nav height | `tools/check-layout.mjs` | sidebar 445px of a 720px viewport (62%) |
| Mobile map position | measured | map starts at y=1429px — **2 screens below the fold** |
| Bottom panel "clipped" | measured | **not a defect** — page scrolls; scrollHeight 1350 vs clientHeight 900. Earlier claim retracted. |

## Default to programmatic, escalate to vision

Do the cheap assertion first, then spend vision on what code cannot judge. `tools/check-layout.mjs`
now measures scroll heights and element positions, which settled two questions that
eyeballing alone had answered *wrong* in both directions.
