/**
 * CesiumJS loader + 3D environment contract (PRD §5.4, §11.4).
 *
 * Env contract (documented in `.env.example`):
 *   VITE_OPEN3DHK_KEY     — LandsD Open3Dhk API key (free, by email to 3dmap@landsd.gov.hk,
 *                           PRD FR-D1). When present the 3D view loads the real Hong Kong
 *                           3D tileset from `https://3d.map.gov.hk/api/3d-visualisation-map/
 *                           tileset.json?key=…`.
 *   VITE_CESIUM_ION_TOKEN — Cesium Ion token, used for World Terrain + OSM Buildings when
 *                           the Open3Dhk key is absent (PRD FR-D2's documented fallback).
 *
 * With NEITHER key the view still works: OpenStreetMap imagery on an ellipsoid, with the
 * buildings/terrain toggles explicitly marked unavailable rather than silently doing
 * nothing. That ladder is the PRD's, implemented literally:
 *
 *   1. Open3Dhk tileset (key present, loads)      → provider `open3dhk`
 *   2. Cesium Ion OSM Buildings + World Terrain   → provider `ion`
 *   3. OSM imagery + ellipsoid, buildings disabled → provider `osm`
 *
 * Loading is LAZY and cached: the ~3 MB SDK is fetched only when the 3D tab opens, from
 * jsDelivr (pinned version), with the CSS and `window.CESIUM_BASE_URL` the SDK needs for
 * its workers and assets. A failed load REJECTS once and clears the cache so a retry is
 * possible; it never leaves a half-initialised global behind.
 */

export const CESIUM_VERSION = '1.131.0';
export const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
export const CESIUM_LOAD_TIMEOUT_MS = 25_000;

export interface CesiumEnv {
  open3dhkKey: string | null;
  ionToken: string | null;
}

/** Reads the two optional keys. Never throws; blank/garbage degrades to null. */
export function readCesiumEnv(): CesiumEnv {
  const open3dhkKey = (import.meta.env.VITE_OPEN3DHK_KEY as string | undefined)?.trim() || null;
  const ionToken = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim() || null;
  return { open3dhkKey, ionToken };
}

/** PRD §5.4's tileset URL, verbatim (the key is URL-encoded, never interpolated raw). */
export function open3dhkTilesetUrl(apiKey: string): string {
  return `https://3d.map.gov.hk/api/3d-visualisation-map/tileset.json?key=${encodeURIComponent(apiKey)}`;
}

let pending: Promise<typeof Cesium> | null = null;

/** Loads CesiumJS once. Concurrent callers share one in-flight promise. */
export function loadCesium(): Promise<typeof Cesium> {
  if (typeof Cesium !== 'undefined') {
    return Promise.resolve(Cesium);
  }
  if (pending) {
    return pending;
  }
  pending = new Promise<typeof Cesium>((resolve, reject) => {
    // The SDK resolves its workers/assets relative to this global; set it first.
    (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${CESIUM_BASE}Widgets/widgets.css`;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = `${CESIUM_BASE}Cesium.js`;
    script.async = true;
    const fail = (message: string): void => {
      window.clearTimeout(timer);
      pending = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(
      () => fail(`CesiumJS did not load within ${Math.round(CESIUM_LOAD_TIMEOUT_MS / 1000)} s`),
      CESIUM_LOAD_TIMEOUT_MS,
    );
    script.onerror = () => fail(`failed to fetch CesiumJS from ${CESIUM_BASE}`);
    script.onload = () => {
      if (typeof Cesium === 'undefined') {
        fail('CesiumJS loaded but the global is missing');
        return;
      }
      window.clearTimeout(timer);
      resolve(Cesium);
    };
    document.head.appendChild(script);
  });
  return pending;
}
