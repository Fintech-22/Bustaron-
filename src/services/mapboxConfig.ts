/**
 * Mapbox configuration contract.
 *
 * Env contract:
 *   VITE_MAPBOX_TOKEN — Mapbox PUBLIC token (pk.*). Vite exposes only variables
 *   prefixed with `VITE_` to the client bundle, so the token reaches the browser
 *   by design. It is supplied at build/dev time via `.env.local` (gitignored);
 *   see `.env.example`. The token MUST NOT be hardcoded in source, tests, or
 *   comments.
 *
 * When the variable is absent or blank the app degrades to the offline SVG
 * tactical map, so a missing token never breaks rendering.
 */
export const MAPBOX_TOKEN: string | null =
  (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || null;

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/dark-v11';

export function hasMapbox(): boolean {
  return MAPBOX_TOKEN !== null;
}
