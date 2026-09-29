# 003 — Granular prefers-reduced-motion

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (~15 lines replaced)

## Problem

The current `prefers-reduced-motion` implementation uses a nuclear `*` selector
with `!important` that kills ALL animations and transitions to 0.01ms —
including color transitions, border changes, and opacity feedback that aid
comprehension without causing vestibular distress.

`src/styles/globals.css:890–896` — current:
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Per the audit criteria: "Reduced motion means fewer and gentler animations,
**not zero** — keep transitions that aid comprehension, remove position
changes."

The current approach removes border-color feedback on button hovers (comprehension-
aiding) alongside the 3D panel slide (position-changing) — throwing the baby
out with the bathwater.

## Target

Replace the nuclear rule with targeted rules that:
1. Kill all `transform` and `translate` animations (position changes)
2. Kill the loading pulse keyframe (repetitive motion)
3. Preserve color, border, background, box-shadow, and opacity transitions
   (comprehension-aiding feedback)

```css
/* src/styles/globals.css:890–896 — target */
@media (prefers-reduced-motion: reduce) {
  /* Drop position changes and repetitive motion */
  .three-d__panel {
    transition: opacity var(--transition-fast);
    transform: none;
  }

  .three-d__panel--open {
    transform: none;
  }

  .empty-state--loading .empty-state__glyph {
    animation: none;
    opacity: 0.6;
  }

  /* Press feedback: instant, not animated */
  .nav-button:active:not(:disabled),
  .role-button:active:not(:disabled),
  .layer-toggle:active:not(:disabled),
  .control-button:active:not(:disabled),
  .link-button:active:not(:disabled),
  .three-d__exit:active,
  .three-d__panel-toggle:active,
  .layer-button:active:not(:disabled),
  .drone-marker:active:not(:disabled) {
    transform: none;
  }

  /* Keep color/border/opacity transitions at reduced speed */
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Note: The `*` selector now only kills `animation-duration` (keyframes), not
`transition-duration`. Color/border/opacity transitions remain at their normal
speed (160ms) — fast enough to not cause vestibular issues, slow enough to
provide feedback.

## Repo conventions to follow

- All media queries are in `src/styles/globals.css`
- The existing `prefers-reduced-motion` block is at lines 890–896
- Class names follow the BEM-like convention used throughout the file

## Steps

1. Open `src/styles/globals.css`.
2. Replace lines 890–896 with the targeted rules above.
3. Verify that the `*` selector no longer includes `transition-duration`.
4. Verify that the 3D panel's `transform` is explicitly set to `none` in both
   closed and open states.

## Boundaries

- Do NOT touch any component files — CSS only.
- Do NOT remove the `*` animation-duration kill — keyframes should still be
  disabled.
- Do NOT add new dependencies.
- If the `:active` selectors from Plan 002 don't exist yet (plan not executed),
  omit those lines — the plan is independently valuable.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - Toggle `prefers-reduced-motion` in DevTools Rendering panel.
  - Confirm: button hovers still show color/border transitions (border-color changes are visible).
  - Confirm: the 3D panel appears instantly with no slide (transform is `none`).
  - Confirm: the loading spinner glyph shows static opacity (0.6) with no pulsing.
  - Confirm: press feedback is instant (no scale animation, but the visual change still happens).
  - Toggle `prefers-reduced-motion` back off and confirm all motion is restored.
- **Done when**: Position-changing animations are disabled under reduced-motion, but color/border/opacity transitions remain.
