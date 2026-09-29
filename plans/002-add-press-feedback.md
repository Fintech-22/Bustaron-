# 002 — Add press feedback to all buttons

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 1 file (~8 lines added)

## Problem

No button in the entire application has `:active` press feedback. Every
pressable element — nav buttons, role buttons, layer toggles, control buttons,
link buttons, drone markers, 3D panel toggle, 3D exit button, layer buttons —
responds to clicks with zero physical feedback. The user presses a button and
nothing visually confirms the press until the state change completes.

This is the single highest-leverage animation fix: press feedback is expected
on every interactive element and its absence makes the entire app feel
unresponsive.

`src/styles/globals.css:286` — current (shared button rule):
```css
.nav-button,
.role-button,
.layer-toggle,
.control-button,
.link-button {
  transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast);
}
```

The `transform` is already in the transition — but no `:active` state sets a
transform value, so it transitions nothing.

## Target

Add a shared `:active` rule for all button variants and the 3D-specific buttons:

```css
/* Press feedback — subtle scale-down on active */
.nav-button:active:not(:disabled),
.role-button:active:not(:disabled),
.layer-toggle:active:not(:disabled),
.control-button:active:not(:disabled),
.link-button:active:not(:disabled) {
  transform: scale(0.97);
}

/* 3D-specific buttons */
.three-d__exit:active,
.three-d__panel-toggle:active,
.layer-button:active:not(:disabled) {
  transform: scale(0.97);
}

/* Drone markers — slightly more pronounced since they're small targets */
.drone-marker:active:not(:disabled) {
  transform: translate(-50%, -50%) scale(0.93);
}
```

Note: `.drone-marker` already has `transform: translate(-50%, -50%)` for
centering — the active state must preserve that offset.

## Repo conventions to follow

- All button styles are in `src/styles/globals.css`, grouped by shared class
- The shared button rule at line 270 already includes `transform` in its
  `transition` — so the `:active` scale will animate without any transition
  changes
- Disabled buttons are excluded via `:not(:disabled)` (consistent with existing
  `:disabled` rules at line 341)

## Steps

1. Open `src/styles/globals.css`.
2. After the disabled button rule block (ends at line 351), add the shared
   `:active:not(:disabled)` rule for the five button variants.
3. After the `.three-d__panel-toggle:hover` rule (line 1249), add the 3D button
   active rules.
4. After the `.drone-marker[aria-pressed='true']` rule (line 628), add the
   drone marker active rule (preserving the `translate(-50%, -50%)` offset).
5. Verify the existing `transition` on line 286 already includes `transform` —
   it does, so no transition changes needed for the shared buttons.
6. For `.three-d__exit` and `.three-d__panel-toggle`, verify they have
   `transition` — `.three-d__panel-toggle` does (line 1244).
   Add `transition: transform var(--transition-fast)` to `.three-d__exit`
   (currently has no transition).
7. For `.layer-button`, add `transition: transform var(--transition-fast),
   border-color var(--transition-fast)` (currently has no transition).

## Boundaries

- Do NOT change markup/structure — CSS only.
- Do NOT add new dependencies.
- Do NOT change the existing `transition` on line 286 — it already includes
  `transform`.
- Do NOT touch the `prefers-reduced-motion` block — the nuclear 0.01ms rule
  already handles active states.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**: Click any nav button, layer toggle, or control button and confirm:
  - The button briefly scales down to 97% on press, then springs back on release.
  - The scale is subtle — not a dramatic shrink.
  - Disabled buttons do NOT scale when clicked.
  - Drone markers scale to 93% (slightly more pronounced) and preserve their centered position.
  - In DevTools, set playback to 10% and confirm the scale starts immediately on press.
  - Toggle `prefers-reduced-motion` and confirm press feedback is instant (0.01ms).
- **Done when**: Every pressable element has a visible `:active` scale and the scale preserves existing transforms.
