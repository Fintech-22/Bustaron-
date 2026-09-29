# 005 — Add transition to table row hover and airspace sidebar links

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (~4 lines added)

## Problem

Table rows in the fleet roster and ESG noise bands change background color on
hover with no transition — an instant color snap that feels cheap compared to
the smooth 160ms transitions on buttons elsewhere in the app.

`src/styles/globals.css:1040` — current:
```css
.data-table tbody tr:hover {
  background: rgba(30, 41, 59, 0.4);
}
```

Similarly, the airspace sidebar links snap on hover:

`src/styles/globals.css:1874` — current:
```css
.airspace-sidebar__link:hover {
  background: rgba(8, 47, 73, 0.4);
}
```

## Target

Add `transition: background var(--transition-fast)` to both elements:

```css
/* line 1040 — target */
.data-table tbody tr {
  transition: background var(--transition-fast);
}

.data-table tbody tr:hover {
  background: rgba(30, 41, 59, 0.4);
}

/* line 1874 — target */
.airspace-sidebar__link {
  transition: background var(--transition-fast);
}

.airspace-sidebar__link:hover {
  background: rgba(8, 47, 73, 0.4);
}
```

Note: These `:hover` rules should also be inside the `@media (hover: hover)`
block from Plan 004. If Plan 004 is not yet executed, add the transition to the
base element and leave the `:hover` rule in place — the transition will work
regardless.

## Repo conventions to follow

- `--transition-fast: 160ms ease` is the existing token (line 97)
- All transitions in the app use this token — no hardcoded durations

## Steps

1. Open `src/styles/globals.css`.
2. Before line 1040, add `transition: background var(--transition-fast)` to
   `.data-table tbody tr`.
3. Before line 1874, add `transition: background var(--transition-fast)` to
   `.airspace-sidebar__link`.
4. If Plan 004 is executed, ensure both `:hover` rules are inside the
   `@media (hover: hover) and (pointer: fine)` block.

## Boundaries

- Do NOT change the hover background color values — only add the transition.
- Do NOT add new dependencies.
- Do NOT touch the `thead th` or `tbody td` styles.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - Hover a fleet roster row — background should smoothly transition over ~160ms, not snap.
  - Hover an airspace sidebar link — same smooth transition.
  - Move the mouse quickly across multiple rows — transitions should retarget smoothly (CSS transitions handle this automatically).
- **Done when**: Both elements have `transition: background var(--transition-fast)` and the hover color change is smooth.
