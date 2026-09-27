/**
 * Minimal fake of the Cesium GLOBAL for tests (see `src/types/cesium.d.ts` for the
 * real surface). Entities are recorded with their constructor options so assertions
 * can inspect geometry, materials and labels; visibility is a plain flag exactly as
 * the scene builder uses it.
 */

export interface FakeEntity {
  id?: string;
  show: boolean;
  options: Record<string, unknown>;
}

export interface FakeViewer {
  destroyed: boolean;
  entities: {
    add(options: Record<string, unknown>): FakeEntity;
    remove(entity: FakeEntity): boolean;
    removeAll(): void;
    values: FakeEntity[];
  };
  scene: {
    primitives: {
      add(primitive: unknown): unknown;
      remove(primitive: unknown): boolean;
      values: unknown[];
    };
    globe: { show: boolean; depthTestAgainstTerrain: boolean };
  };
  imageryLayers: { addImageryProvider(provider: unknown): unknown };
  camera: {
    flyTo(options: Record<string, unknown>): void;
    setView(options: Record<string, unknown>): void;
    lastView: Record<string, unknown> | null;
  };
  destroy(): void;
  isDestroyed(): boolean;
}

export function makeFakeCesium(options?: { buildingsFail?: boolean }): typeof Cesium {
  const entities: FakeEntity[] = [];
  const primitives: unknown[] = [];
  let view: Record<string, unknown> | null = null;

  const viewer: FakeViewer = {
    destroyed: false,
    entities: {
      add(entityOptions: Record<string, unknown>): FakeEntity {
        // Mirror the real SDK: `id`/`show` live on the entity itself, the rest in
        // constructor options. The scene builder reads `entity.id` and writes
        // `entity.show` directly, so both must be top-level.
        const entity: FakeEntity = {
          id: typeof entityOptions.id === 'string' ? entityOptions.id : undefined,
          show: true,
          options: entityOptions,
        };
        entities.push(entity);
        return entity;
      },
      remove(entity: FakeEntity): boolean {
        const index = entities.indexOf(entity);
        if (index === -1) {
          return false;
        }
        entities.splice(index, 1);
        return true;
      },
      removeAll(): void {
        entities.length = 0;
      },
      get values(): FakeEntity[] {
        return entities;
      },
    },
    scene: {
      primitives: {
        add(primitive: unknown): unknown {
          primitives.push(primitive);
          return primitive;
        },
        remove(primitive: unknown): boolean {
          const index = primitives.indexOf(primitive);
          if (index === -1) {
            return false;
          }
          primitives.splice(index, 1);
          return true;
        },
        get values(): unknown[] {
          return primitives;
        },
      },
      globe: { show: true, depthTestAgainstTerrain: false },
    },
    imageryLayers: {
      addImageryProvider(provider: unknown): unknown {
        return provider;
      },
    },
    camera: {
      flyTo(options: Record<string, unknown>): void {
        view = options;
      },
      setView(options: Record<string, unknown>): void {
        view = options;
      },
      get lastView(): Record<string, unknown> | null {
        return view;
      },
    },
    destroy(): void {
      viewer.destroyed = true;
    },
    isDestroyed(): boolean {
      return viewer.destroyed;
    },
  };
  const color = (r: number, g: number, b: number, _a = 1): CesiumColor => ({
    withAlpha(alpha: number): CesiumColor {
      return color(r, g, b, alpha);
    },
  });

  const CesiumStub = {
    Viewer: class {
      constructor(_container: Element | string, _options: Record<string, unknown>) {
        return viewer as unknown as CesiumViewer;
      }
    },
    Cartesian3: {
      fromDegrees(lng: number, lat: number, height = 0): { lng: number; lat: number; height: number } {
        return { lng, lat, height };
      },
      fromDegreesArray(coordinates: number[]): number[] {
        return coordinates;
      },
      fromDegreesArrayHeights(coordinates: number[]): number[] {
        return coordinates;
      },
    },
    Color: Object.assign(
      (r: number, g: number, b: number, a = 1): CesiumColor => color(r, g, b, a),
      {
        fromCssColorString(_css: string): CesiumColor {
          return color(0, 0, 0) as CesiumColor;
        },
        RED: color(1, 0, 0),
        ORANGE: color(1, 0.5, 0),
        CYAN: color(0, 1, 1),
        WHITE: color(1, 1, 1),
      },
    ),
    OpenStreetMapImageryProvider: class {
      constructor(public options: { url: string }) {}
    },
    EllipsoidTerrainProvider: class {},
    PolygonHierarchy: class {
      constructor(public positions: unknown) {}
    },
    PolylineDashMaterialProperty: class {
      constructor(public options: { color: CesiumColor; dashLength?: number }) {}
    },
    Cesium3DTileset: {
      fromUrl: options?.buildingsFail
        ? (): Promise<never> => Promise.reject(new Error('tileset refused'))
        : (url: string): Promise<{ url: string }> => Promise.resolve({ url }),
    },
    Ion: { defaultAccessToken: '' },
    createOsmBuildingsAsync: (): Promise<{ kind: string }> => Promise.resolve({ kind: 'osm-buildings' }),
    createWorldTerrainAsync: (): Promise<{ kind: string }> => Promise.resolve({ kind: 'world-terrain' }),
  } as unknown as CesiumStatic;

  // The Viewer constructor hands this instance back; stashing it on the stub gives
  // tests a direct handle to the entity collection the scene builder populated.
  return Object.assign(CesiumStub, { __viewer: viewer }) as typeof Cesium;
}
