# 006 — Dashboard section crossfade on tab switch

- **Status**: TODO
- **Commit**: 677e604
- **Severity**: MEDIUM
- **Category**: Preventing a jarring change
- **Estimated scope**: 2 files (~25 lines added)

## Problem

When the user switches between dashboard sections (Live Map → Flight Plans →
Credit Wallet etc.), the entire content area instantly swaps via conditional
render — a jarring teleport with no visual bridge.

`src/components/layout/AppShell.tsx:107–136` — current:
```tsx
{activeSection === 'operations' && <MapHost />}
{activeSection === 'missions' && <FlightPlansPanel />}
{activeSection === 'wallet' && <CreditWalletPanel />}
// ...etc
```

Each conditional is an instant mount/unmount. The user clicks a nav button and
the entire main content area blinks to a different layout.

## Target

Add a CSS crossfade: outgoing content fades out (opacity 1 → 0), incoming
content fades in (opacity 0 → 1). Use a keyed wrapper so React treats each
section as a different element, triggering the CSS transition on mount.

```tsx
/* AppShell.tsx — target: wrap section content in a keyed div */
<div key={activeSection} className="section-transition">
  {activeSection === 'operations' && <MapHost />}
  {activeSection === 'missions' && <FlightPlansPanel />}
  {/* ... */}
</div>
```

```css
/* src/styles/globals.css — target */
.section-transition {
  animation: bustaron-fade-in 200ms var(--ease-out);
}

@keyframes bustaron-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .section-transition {
    animation: none;
  }
}
```

Note: This uses `@keyframes` (not transitions) because the content is
mounting — there's no existing element to transition from. The keyframe is
a simple opacity fade, not position movement, so it's vestibular-safe.

Duration: 200ms — within the "Dropdowns, selects" budget (150–250ms) and
well under the 300ms UI cap.

## Repo conventions to follow

- Keyframes are named with `bustaron-` prefix (existing: `bustaron-pulse`)
- Easing tokens from Plan 001: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- `prefers-reduced-motion` handling kills the animation entirely (opacity-only,
  safe to remove)

## Steps

1. Open `src/styles/globals.css`.
2. After the `bustaron-pulse` keyframes (line 888), add the `bustaron-fade-in`
   keyframes.
3. Add the `.section-transition` class with the animation.
4. In the `@media (prefers-reduced-motion: reduce)` block, add
   `.section-transition { animation: none; }`.
5. Open `src/components/layout/AppShell.tsx`.
6. Wrap the section content (lines 107–136) in a `<div key={activeSection}
   className="section-transition">`.
7. Ensure the wrapping div doesn't break the existing `map-column` layout —
   it should be a plain wrapper with no display properties.

## Boundaries

- Do NOT animate layout properties (width, height, margin) — opacity only.
- Do NOT add a slide or transform — the content area is large and a slide
  would be vestibular-triggering.
- Do NOT stagger child elements — the section content should fade as a unit.
- Do NOT add new dependencies.
- Do NOT change the conditional rendering logic — only wrap it.

## Verification

- **Mechanical**: `tsc --noEmit` (0 errors), `eslint .` (0 errors), `vite build` (0 errors), `vitest run` (144/144 pass).
- **Feel check**:
  - Click between nav sections (Live Map → Flight Plans → Wallet) and confirm a brief, smooth fade — not an instant blink.
  - The fade should be fast enough to not slow down navigation (200ms).
  - In DevTools Animations panel, confirm the fade is a simple opacity curve with `ease-out` (fast start, gentle settle).
  - Toggle `prefers-reduced-motion` and confirm sections appear instantly with no fade.
  - Rapidly click between sections — confirm no animation buildup or overlap (each click restarts the fade cleanly due to the `key` prop).
- **Done when**: Section switches show a 200ms opacity fade with `--ease-out` and the fade is disabled under reduced-motion.
