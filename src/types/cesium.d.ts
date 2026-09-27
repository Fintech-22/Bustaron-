/**
 * Minimal structural declarations for the CesiumJS surface this app uses.
 *
 * CesiumJS is loaded from a CDN at RUNTIME (`src/services/cesiumLoader.ts`) because
 * `npm install` is not available in this project — see the vault decision note on the
 * Mapbox SDK, which is loaded the same way. With no package installed there are no
 * types to import, so `declare const Cesium` describes **only the members actually
 * called**, exactly like `src/types/mapbox.d.ts`.
 *
 * Keep this file minimal: every member here is a claim about the SDK that the 3D
 * tests exercise against a fake, and the live scene exercises against the real CDN
 * build. Adding a member that is never called would be dead weight.
 */

interface CesiumColor {
  withAlpha(alpha: number): CesiumColor;
}

interface CesiumCartesian3Static {
  fromDegrees(lng: number, lat: number, height?: number): unknown;
  fromDegreesArray(coordinates: number[]): unknown;
  fromDegreesArrayHeights(coordinates: number[]): unknown;
}

interface CesiumColorStatic {
  new (red: number, green: number, blue: number, alpha?: number): CesiumColor;
  fromCssColorString(css: string): CesiumColor;
  RED: CesiumColor;
  ORANGE: CesiumColor;
  CYAN: CesiumColor;
  WHITE: CesiumColor;
}

interface CesiumEntity {
  id?: string;
  show: boolean;
}

interface CesiumEntityCollection {
  add(entity: Record<string, unknown>): CesiumEntity;
  remove(entity: CesiumEntity): boolean;
  removeAll(): void;
  values: CesiumEntity[];
}

interface CesiumPrimitiveCollection {
  add(primitive: unknown): unknown;
  remove(primitive: unknown): boolean;
  length?: number;
}

interface CesiumViewer {
  entities: CesiumEntityCollection;
  scene: {
    primitives: CesiumPrimitiveCollection;
    globe: { show: boolean; depthTestAgainstTerrain: boolean };
  };
  imageryLayers: { addImageryProvider(provider: unknown): unknown };
  camera: {
    flyTo(options: Record<string, unknown>): void;
    setView(options: Record<string, unknown>): void;
  };
  destroy(): void;
  isDestroyed(): boolean;
}

interface CesiumStatic {
  Viewer: new (container: Element | string, options: Record<string, unknown>) => CesiumViewer;
  Cartesian3: CesiumCartesian3Static;
  Color: CesiumColorStatic;
  OpenStreetMapImageryProvider: new (options: { url: string }) => unknown;
  EllipsoidTerrainProvider: new () => unknown;
  PolygonHierarchy: new (positions: unknown) => unknown;
  PolylineDashMaterialProperty: new (options: { color: CesiumColor; dashLength?: number }) => unknown;
  Cesium3DTileset: { fromUrl(url: string): Promise<unknown> };
  Ion?: { defaultAccessToken: string };
  createOsmBuildingsAsync?: () => Promise<unknown>;
  createWorldTerrainAsync?: () => Promise<unknown>;
}

declare const Cesium: CesiumStatic;
