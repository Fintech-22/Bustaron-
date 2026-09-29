# 009 — Skycell detail panel fade-in

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: LOW
- **Category**: Spatial consistency, preventing a jarring change
- **Estimated scope**: 2 files (~10 lines added)

## Problem

When a user clicks a skycell on the Mapbox map, the detail panel appears
instantly with no transition — a small box pops into existence at the corner
of the map.

The skycell detail panel is conditionally rendered in `MapboxMap.tsx` when a
skycell is selected. It appears as a positioned overlay (`position: absolute;
top; right`) with no entry animation.

## Target

Add a simple opacity + scale fade-in using `@starting-style` for CSS-only entry
(or a `data-mounted` attribute fallback for broader browser support):

```css
/* src/styles/globals.css — target */
.skycell-detail {
  /* existing properties... */
  animation: bustaron-panel-in 160ms var(--ease-out);
}

@keyframes bustaron-panel-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .skycell-detail {
    animation: none;
  }
}
```

Duration: 160ms — within the "Tooltips, small popovers" budget (125–200ms).
Scale starts at 0.96 (not 0) per the "never scale(0)" rule. The panel is small
enough that a subtle scale reads as "appearing from the click point" without
needing `transform-origin` calibration.

## Repo conventions to follow

- Keyframes named with `bustaron-` prefix
- Easing token from Plan 001: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- `prefers-reduced-motion` handling: kill the animation

## Steps

1. Open `src/styles/globals.css`.
2. At the `.skycell-detail` rule (line 2003), add the `animation` property.
3. After the `bustaron-pulse` keyframes (or the `bustaron-fade-in` keyframes
   from Plan 006), add the `bustaron-panel-in` keyframes.
4. Add reduced-motion override.
5. No component changes needed — the panel is already conditionally rendered
   and will play the animation on mount.

## Boundaries

- Do NOT use `scale(0)` — start at `scale(0.96)`.
- Do NOT animate position (top/right) — the panel should appear in place.
- Do NOT add a slide — the panel is a small overlay, not a drawer.
- Do NOT add `transform-origin` — the default center origin is fine for a
  small panel (unlike popovers anchored to triggers).
- Do NOT add new dependencies.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - Click a skycell on the Mapbox map — the detail panel should fade in with a subtle scale (0.96 → 1) over ~160ms.
  - Click a different skycell — the panel should re-render and replay the animation.
  - Close the panel — it should disappear instantly (no exit animation needed at this severity).
  - Toggle `prefers-reduced-motion` and confirm the panel appears instantly.
- **Done when**: The skycell detail panel enters with a 160ms opacity + scale(0.96→1) fade, disabled under reduced-motion.
