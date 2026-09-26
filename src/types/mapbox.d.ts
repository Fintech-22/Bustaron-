/// <reference types="vite/client" />

/**
 * Ambient typing for the Mapbox GL JS global loaded from the CDN (index.html).
 * Only the surface BUSTARON uses is declared — keep it minimal and extend as
 * the overlay grows. The SDK is NOT an npm dependency (npm install is banned
 * in this environment; see vault decision note).
 */
interface MapboxLngLatBounds {
  getNorth(): number;
  getSouth(): number;
  getEast(): number;
  getWest(): number;
}

interface MapboxPointLike {
  x: number;
  y: number;
}

interface MapboxMouseEvent {
  features?: { properties: Record<string, unknown> }[];
  point: MapboxPointLike;
  lngLat: { lng: number; lat: number };
}

interface MapboxMapInstance {
  remove(): void;
  on(event: string, handler: (event: MapboxMouseEvent) => void): void;
  on(event: string, layerId: string, handler: (event: MapboxMouseEvent) => void): void;
  once(event: string, handler: () => void): void;
  queryRenderedFeatures(point?: [number, number], options?: { layers?: string[] }): { properties: Record<string, unknown>; layer?: { id?: string } }[];
  addSource(id: string, source: unknown): void;
  addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: { pixelRatio?: number }): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(layer: unknown, beforeId?: string): void;
  getLayer(id: string): unknown | undefined;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  setFilter(layerId: string, filter: unknown): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setCenter(center: [number, number]): void;
  setZoom(zoom: number): void;
  getCanvas(): HTMLCanvasElement;
  getContainer(): HTMLElement;
  project(lngLat: { lng: number; lat: number }): MapboxPointLike;
  unproject(point: MapboxPointLike): { lng: number; lat: number };
  fitBounds(bounds: [[number, number], [number, number]], options?: { padding?: number; duration?: number; maxZoom?: number }): void;
}

interface MapboxMapOptions {
  container: HTMLElement;
  style: string;
  center: [number, number];
  zoom: number;
}

interface MapboxMarkerOptions {
  element?: HTMLElement;
  color?: string;
  anchor?: string;
  rotationAlignment?: 'map' | 'viewport' | 'auto';
}

interface MapboxMarkerInstance {
  setLngLat(lngLat: { lng: number; lat: number }): MapboxMarkerInstance;
  setRotation(deg: number): MapboxMarkerInstance;
  addTo(map: MapboxMapInstance): MapboxMarkerInstance;
  remove(): void;
  getElement(): HTMLElement;
}

interface MapboxGlStatic {
  accessToken: string;
  Map: new (options: MapboxMapOptions) => MapboxMapInstance;
  Marker: new (options?: MapboxMarkerOptions) => MapboxMarkerInstance;
  LngLatBounds: new (
    corner1: [number, number] | { lng: number; lat: number },
    corner2: [number, number] | { lng: number; lat: number },
  ) => MapboxLngLatBounds;
  supportsWebpQuery?: boolean;
}

declare const mapboxgl: MapboxGlStatic;
