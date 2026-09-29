# 008 — 3D view overlay fade enter/exit

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: MEDIUM
- **Category**: Preventing a jarring change, spatial consistency
- **Estimated scope**: 2 files (~20 lines added)

## Problem

The 3D view overlay appears and disappears instantly — a full-screen takeover
that blinks into existence with no transition.

`src/components/layout/AppShell.tsx:147–151` — current:
```tsx
{threeDView && (
  <div className="three-d-overlay">
    <ThreeDViewPanel />
  </div>
)}
```

The overlay has `position: fixed; inset: 0; z-index: 60` — it covers the entire
viewport. Entering and exiting this state with no animation is one of the most
jarring moments in the app.

## Target

Add a CSS fade on the overlay container. For exit, we need a brief delay before
unmounting — use a `data-closing` attribute set by the component before
calling `closeThreeDView`.

```css
/* src/styles/globals.css — target */
.three-d-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--color-bg);
  animation: bustaron-overlay-in 250ms var(--ease-out);
}

.three-d-overlay[data-closing="true"] {
  animation: bustaron-overlay-out 200ms var(--ease-out) forwards;
}

@keyframes bustaron-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes bustaron-overlay-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .three-d-overlay,
  .three-d-overlay[data-closing="true"] {
    animation: none;
  }
}
```

In `ThreeDViewPanel.tsx`, add a closing state:

```tsx
const [closing, setClosing] = useState(false);

const handleClose = (): void => {
  setClosing(true);
  setTimeout(() => closeThreeDView(), 200);
};

// Pass closing state to the overlay wrapper
// In AppShell, read the closing state
```

Duration: 250ms enter (within modal/drawer budget 200–500ms), 200ms exit
(faster exit is standard — the user has already decided to leave).

## Repo conventions to follow

- Keyframes named with `bustaron-` prefix
- Easing token from Plan 001: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- `prefers-reduced-motion` handling: kill both animations

## Steps

1. Open `src/styles/globals.css`.
2. At the `.three-d-overlay` rule (line 1145), add the `animation` property.
3. Add the `[data-closing="true"]` rule and both keyframes after the overlay rules.
4. Add reduced-motion override.
5. Open `src/components/three/ThreeDViewPanel.tsx`.
6. Add `closing` state and replace `closeThreeDView` in the exit button's
   `onClick` with the new `handleClose` function.
7. Open `src/components/layout/AppShell.tsx`.
8. The overlay div needs to receive `data-closing` — either lift the closing
   state to the store or render the attribute from ThreeDViewPanel via a
   callback prop. Simplest: add `closing` state to the Zustand store.

## Boundaries

- Do NOT animate `transform` on the overlay — a full-screen slide would be
  vestibular-triggering. Opacity only.
- Do NOT add a scale or blur — the overlay is too large for these to feel good.
- Do NOT block the exit — the 200ms timeout must be brief enough that the user
  doesn't perceive a delay.
- Do NOT add new dependencies.
- The Cesium scene initialization should NOT be delayed by the fade — it can
  start building during the enter animation.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - Click "3D View" in the sidebar — the overlay should fade in over ~250ms with `ease-out` (fast appear, gentle settle).
  - Click "Exit 3D" — the overlay should fade out over ~200ms, then unmount.
  - The Cesium canvas should be visible during the fade-in (not a blank screen).
  - Rapidly toggle 3D view open/closed — no animation buildup or stuck states.
  - Toggle `prefers-reduced-motion` and confirm the overlay appears/disappears instantly.
  - In DevTools Animations panel at 10%, confirm the fade is a smooth opacity curve.
- **Done when**: The 3D overlay enters with a 250ms fade and exits with a 200ms fade, both using `--ease-out`, disabled under reduced-motion.
