# 004 — Add hover gating and clean dead transition property

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: MEDIUM
- **Category**: Accessibility, Performance
- **Estimated scope**: 1 file (~10 lines changed)

## Problem

### A. No hover gating

Hover effects (border-color, background changes) fire on touch devices when the
user taps a button. On mobile, a tap triggers a "stuck hover" state that lingers
until the user taps elsewhere — making the app feel broken.

Per the audit criteria: `@media (hover: hover) and (pointer: fine)` should gate
all `:hover` motion so touch devices don't get false hovers.

### B. Dead `transform` in button transition

`src/styles/globals.css:286` — current:
```css
transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast);
```

The `transform` property is in the transition but no `:hover` or `[aria-current]`
state changes `transform` — so it transitions nothing. If Plan 002 adds `:active`
press feedback, this `transform` becomes live, but only for the active state.
The hover state should NOT animate transform.

## Target

### A. Wrap hover rules in hover-capable media query

Move all `:hover` rules for buttons into a `@media (hover: hover) and (pointer: fine)`
block. The existing `:hover` rules at lines 297–301 and 323–330 should be
wrapped.

### B. Clean the transition

Keep `transform` in the transition (for `:active` press feedback from Plan 002)
but understand it only fires on `:active`, not `:hover`. No change needed to
the transition itself — the dead property becomes live once Plan 002 is executed.

If Plan 002 is NOT executed, remove `transform` from the transition:
```css
transition: border-color var(--transition-fast), background var(--transition-fast);
```

## Repo conventions to follow

- Media queries are in `src/styles/globals.css`, grouped at the end of each section
- The existing responsive breakpoints (`@media (min-width: 768px)` etc.) are at
  lines 903, 951, 995 — hover gating goes alongside them

## Steps

1. Open `src/styles/globals.css`.
2. Find the sidebar button hover rules at lines 297–301:
   ```css
   .sidebar .nav-button:hover,
   .sidebar .control-button:hover {
     background: rgba(255, 255, 255, 0.12);
     border-color: rgba(255, 255, 255, 0.2);
   }
   ```
3. Wrap these in `@media (hover: hover) and (pointer: fine) { ... }`.
4. Find the shared button hover rules at lines 323–330:
   ```css
   .nav-button:hover,
   .role-button:hover,
   .layer-toggle:hover,
   .control-button:hover,
   .link-button:hover {
     border-color: var(--color-border-strong);
     background: var(--color-bg);
   }
   ```
5. Wrap these in the same media query.
6. Find the drone marker hover rule at line 622:
   ```css
   .drone-marker:hover {
     border-color: var(--color-cyan);
     box-shadow: var(--shadow-marker-hover);
   }
   ```
7. Wrap this in the same media query.
8. Find the 3D panel toggle hover at line 1247 and 3D exit hover at line 1221 —
   wrap both.
9. Find the table row hover at line 1040:
   ```css
   .data-table tbody tr:hover {
     background: rgba(30, 41, 59, 0.4);
   }
   ```
10. Wrap this in the same media query.

## Boundaries

- Do NOT touch `:focus-visible` rules — focus states must work on all devices.
- Do NOT touch `[aria-current]` or `[aria-pressed]` rules — these are state
  indicators, not hover.
- Do NOT add new dependencies.
- Do NOT change the transition property list — only wrap `:hover` rules.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - On desktop: hover a nav button — border-color and background should transition.
  - On desktop: hover a drone marker — border-color and box-shadow should transition.
  - On mobile (or DevTools touch simulation): tap a button — NO stuck hover state.
  - On mobile: tap a button — the button should NOT show hover colors after release.
  - Confirm `:focus-visible` rings still appear on keyboard focus (not affected by hover gating).
- **Done when**: All `:hover` rules are inside `@media (hover: hover) and (pointer: fine)` and touch devices no longer show stuck hover states.
