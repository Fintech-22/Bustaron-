/// <reference types="vite/client" />

/**
 * Minimal ambient typing for the Mapbox GL JS global.
 *
 * The SDK is loaded from the Mapbox CDN via a script tag in index.html (no npm
 * dependency), so `mapboxgl` exists as a browser global rather than a module.
 * Only the surface used by MapboxMap is declared.
 */
interface MapboxMapInstance {
  remove(): void;
}

interface MapboxMapOptions {
  container: HTMLElement;
  style: string;
  center: [number, number];
  zoom: number;
}

interface MapboxGlStatic {
  accessToken: string;
  Map: new (options: MapboxMapOptions) => MapboxMapInstance;
}

declare const mapboxgl: MapboxGlStatic;
