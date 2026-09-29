# BUSTARON Animation Plans

## Corrective plans (Phase 1 — Motion Audit)

| # | Title | Severity | Status | Dependencies |
|---|-------|----------|--------|-------------|
| 001 | Fix 3D panel entrance easing and tokenize hardcoded durations | HIGH | DONE | None |
| 002 | Add press feedback to all buttons | HIGH | DONE | None (but 001's easing token is used) |
| 003 | Granular prefers-reduced-motion | MEDIUM | DONE | 002 (references :active selectors) |
| 004 | Add hover gating and clean dead transition property | MEDIUM | DONE | None (but 002 makes `transform` in transition live) |
| 005 | Add transition to table row hover and airspace sidebar links | LOW | DONE | 004 (hover rules should be inside hover media query) |

## Additive plans (Phase 2 — Animation Opportunities)

| # | Title | Severity | Status | Dependencies |
|---|-------|----------|--------|-------------|
| 006 | Dashboard section crossfade on tab switch | MEDIUM | DONE | None |
| 007 | Flight detail row expand/collapse animation | MEDIUM | DONE | None |
| 008 | 3D view overlay fade enter/exit | MEDIUM | DONE | 001 (uses --ease-out token) |
| 009 | Skycell detail panel fade-in | LOW | DONE | None |

## Recommended execution order

1. **001** — Tokenize durations + fix panel easing (foundation for all subsequent plans)
2. **002** — Press feedback (highest user-facing impact)
3. **004** — Hover gating (accessibility + dead code cleanup)
4. **003** — Granular reduced-motion (accessibility refinement)
5. **005** — Table hover transition (polish)
6. **006** — Dashboard section crossfade (additive, high visibility)
7. **008** — 3D overlay fade (additive, uses 001's token)
8. **007** — Flight detail expand/collapse (additive, moderate complexity)
9. **009** — Skycell detail fade-in (additive, low priority)

## Commit stamp

All plans stamped at commit `677e604`.
