# 007 — Flight detail row expand/collapse animation

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: MEDIUM
- **Category**: State indication, preventing a jarring change
- **Estimated scope**: 2 files (~20 lines added)

## Problem

When a flight detail row is expanded, the body content appears instantly via
conditional render — a large panel pops into existence with no transition,
causing a visible layout jump.

`src/components/panels/FlightDetailPanel.tsx:423` — current:
```tsx
{isOpen && expanded && expanded.id === mission.id && (
  <div className="flight-detail__body">
    {/* large content area with map, cards, rules, contact */}
  </div>
)}
```

The same pattern is used for the rules feed at line 233:
```tsx
{isOpen && (
  <div className="flight-detail__rules-summary">...</div>
)}
```

## Target

Use CSS `grid-template-rows` transition for height animation (the modern,
GPU-friendly approach that avoids animating `height` directly):

```css
/* src/styles/globals.css — target */
.flight-detail__row-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 250ms var(--ease-out);
}

.flight-detail__row-wrapper--open {
  grid-template-rows: 1fr;
}

.flight-detail__row-wrapper > .flight-detail__body {
  overflow: hidden;
  opacity: 0;
  transition: opacity 200ms var(--ease-out);
}

.flight-detail__row-wrapper--open > .flight-detail__body {
  opacity: 1;
  transition-delay: 50ms;
}

@media (prefers-reduced-motion: reduce) {
  .flight-detail__row-wrapper,
  .flight-detail__row-wrapper > .flight-detail__body {
    transition: none;
  }
}
```

In the component, replace the conditional render with an always-rendered
wrapper:

```tsx
/* FlightDetailPanel.tsx — target */
<div className={`flight-detail__row-wrapper ${isOpen ? 'flight-detail__row-wrapper--open' : ''}`}>
  {expanded && expanded.id === mission.id && (
    <div className="flight-detail__body">
      {/* existing content */}
    </div>
  )}
</div>
```

Duration: 250ms — within the "Dropdowns, selects" budget (150–250ms).

## Repo conventions to follow

- Easing token from Plan 001: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- `prefers-reduced-motion` handling: kill transitions, content still accessible
- Existing class naming: `flight-detail__row--open` at line 1585

## Steps

1. Open `src/styles/globals.css`.
2. After the `.flight-detail__body` rule (line 1636), add the
   `.flight-detail__row-wrapper` grid-transition rules.
3. Add the reduced-motion override in the `@media (prefers-reduced-motion: reduce)` block.
4. Open `src/components/panels/FlightDetailPanel.tsx`.
5. At line 423, replace the `{isOpen && expanded && ...}` conditional with
   the always-rendered wrapper div.
6. Move the `isOpen` check to the wrapper class name instead of conditional render.
7. Keep the `expanded && expanded.id === mission.id` check inside the wrapper
   to avoid rendering content for non-selected rows.

## Boundaries

- Do NOT use `max-height` animation — it requires a hardcoded pixel value and
  clips content. Use `grid-template-rows: 0fr → 1fr` instead.
- Do NOT animate `height` directly — it triggers layout recalculation.
- Do NOT add new dependencies.
- Do NOT change the content of the expanded body — only the animation wrapper.
- Do NOT apply this to the rules feed at line 233 — that's a smaller toggle;
  apply only to the main flight detail body for now.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - Click a flight detail row toggle — the body should smoothly expand height + fade in content over ~250ms.
  - Click again to collapse — the body should smoothly retract.
  - Rapidly toggle — transitions should retarget smoothly (CSS transitions handle this).
  - The chevron indicator (`⌃` / `⌄`) still updates instantly (it's separate from the body animation).
  - Toggle `prefers-reduced-motion` and confirm the body appears instantly with no animation.
  - In DevTools Animations panel at 10%, confirm the height expands with `ease-out` (fast start, gentle settle).
- **Done when**: Flight detail rows expand/collapse with a 250ms grid-template-rows + opacity transition, disabled under reduced-motion.
