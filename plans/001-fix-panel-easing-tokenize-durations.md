# 001 — Fix 3D panel entrance easing and tokenize hardcoded durations

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: HIGH
- **Category**: Easing & duration
- **Estimated scope**: 1 file (~5 lines changed)

## Problem

The 3D slide-in control panel uses `ease` for an entrance animation. Per the
easing decision order, entrances must use `ease-out` (starts fast, feels
responsive). `ease` starts with a slow lead-in that delays the exact moment the
user is watching — the panel appears to hesitate before sliding up.

Additionally, two durations are hardcoded instead of using design tokens,
breaking the single-source-of-truth convention:

`src/styles/globals.css:1272` — current:
```css
.three-d__panel {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
```

`src/styles/globals.css:876` — current:
```css
.empty-state--loading .empty-state__glyph {
  animation: bustaron-pulse 1.4s ease-in-out infinite;
}
```

## Target

Introduce two new duration tokens and a custom ease-out curve, then reference
them:

```css
/* src/styles/globals.css — in :root block, after line 97 */
--transition-panel: 300ms var(--ease-out);
--transition-pulse: 1.4s ease-in-out;
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);

/* src/styles/globals.css:1272 — target */
.three-d__panel {
  transition: transform var(--transition-panel), opacity var(--transition-panel);
}

/* src/styles/globals.css:876 — target */
.empty-state--loading .empty-state__glyph {
  animation: bustaron-pulse var(--transition-pulse) infinite;
}
```

## Repo conventions to follow

- Easing/duration tokens live in `:root` in `src/styles/globals.css` (line 97 is
  the existing `--transition-fast: 160ms ease`)
- Components reference tokens via `var(--token-name)`, never inline magic values
- Existing exemplar: `--transition-fast` used at lines 286, 619, 1244

## Steps

1. Open `src/styles/globals.css`.
2. In the `:root` block, after line 97 (`--transition-fast: 160ms ease;`), add:
   ```css
   --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
   --transition-panel: 300ms var(--ease-out);
   --transition-pulse: 1.4s ease-in-out;
   ```
3. At line 876, replace `1.4s ease-in-out infinite` with `var(--transition-pulse) infinite`.
4. At line 1272, replace `transform 0.3s ease, opacity 0.3s ease` with `transform var(--transition-panel), opacity var(--transition-panel)`.

## Boundaries

- Do NOT touch any component files — this is CSS-token-only.
- Do NOT change the 300ms duration value itself — only the easing and tokenization.
- Do NOT add new dependencies.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**: Open the 3D View tab, click the panel toggle button, and confirm:
  - The panel slides up with a responsive feel (fast start, gentle settle) — not a symmetric ease.
  - In DevTools Animations panel, set playback to 10% and confirm the curve is front-loaded (fast initial movement, decelerating to rest).
  - Toggle `prefers-reduced-motion` (Rendering panel) and confirm the panel appears instantly (0.01ms).
- **Done when**: Both hardcoded durations are replaced with token references and the 3D panel easing reads as `var(--ease-out)`.
