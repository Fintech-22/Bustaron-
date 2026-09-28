/**
 * CesiumJS scene builder for the 3D View tab (PRD §11.4 FR-3D-V1..V6, §5.4).
 *
 * Deliberately a plain module, not a React hook: the Cesium namespace is a GLOBAL that
 * `loadCesium()` guarantees before this is called, and the builder returns a controller.
 * That is what lets `threeDView.test.tsx` drive the whole scene with a FAKE Cesium global
 * and assert real behaviour — entities, materials, layer visibility — without a WebGL
 * context, a network call, or a pixel.
 *
 * Layer groups map onto the shared `LayerId`s wherever the 2D map already has one, so a
 * toggle flipped here flips there too; `buildings`, `terrain` and `trails` are 3D-only.
 *
 * Honest limits, recorded rather than hidden:
 *   * "hover metadata" (FR-3D-V3) is attached as entity `name`/`description`; the Cesium
 *     infoBox/selection UI is disabled in this increment, so a future infoBox can show it
 *     without recomputing anything.
 *   * the wind overlay is one label per weather cell (the cell's own wind), not a vector
 *     field; the 2D map draws the arrows.
 */

import type { AirspaceZone, Drone, GeoPoint, LayerId, Mission, WeatherAlert } from '../../types/domain';
import type { Skycell } from '../../services/skycells';
import { open3dhkTilesetUrl, type CesiumEnv } from '../../services/cesiumLoader';

/** PRD FR-3D-V3 / §5.3: RFZ volumes are extruded 0–400 m. */
export const RFZ_VOLUME_HEIGHT_M = 400;
/** Traffic volumes are drawn squat so they never occlude the drones above them. */
export const TRAFFIC_VOLUME_HEIGHT_M = 120;
/** Drone glyph size (FR-3D-V4 "simple cone/cylinder" — a cylinder reads better at range). */
export const DRONE_GLYPH_RADIUS_M = 6;
export const DRONE_GLYPH_LENGTH_M = 12;

export const RESTRICTED_COLOR = '#ef4444';
export const SANDBOX_COLOR = '#f59e0b';
export const CORRIDOR_COLOR = '#38bdf8';
export const PLANNED_ROUTE_COLOR = '#22d3ee';

export type ThreeDLayerId = LayerId | 'buildings' | 'terrain' | 'trails';

export interface SceneCounts {
  rfz: number;
  drones: number;
  routes: number;
  trails: number;
  weather: number;
  traffic: number;
}

export interface SceneStatus {
  /** Which imagery/tiles provider actually loaded (the PRD ladder). */
  provider: 'open3dhk' | 'ion' | 'osm';
  buildings: 'open3dhk' | 'ion' | 'unavailable';
  terrain: 'ion' | 'ellipsoid';
  notes: string[];
}

export interface SceneController {
  viewer: CesiumViewer;
  status: SceneStatus;
  counts: SceneCounts;
  setLayer(layer: ThreeDLayerId, visible: boolean): void;
  destroy(): void;
}

export interface SceneInputs {
  container: HTMLElement;
  zones: AirspaceZone[];
  drones: Drone[];
  missions: Mission[];
  weatherAlerts: WeatherAlert[];
  skycells: Skycell[];
  plannedRoute: GeoPoint[] | null;
  env: CesiumEnv;
}

interface EntityGroup {
  layer: ThreeDLayerId;
  entities: CesiumEntity[];
}

/** Ring in [lng,lat,…] order for `fromDegreesArray`. */
function ringToDegrees(points: GeoPoint[]): number[] {
  const flat: number[] = [];
  for (const point of points) {
    flat.push(point.lng, point.lat);
  }
  return flat;
}

function zoneColor(kind: AirspaceZone['kind']): string {
  if (kind === 'rfz' || kind === 'sensitive') {
    return RESTRICTED_COLOR;
  }
  if (kind === 'sandbox') {
    return SANDBOX_COLOR;
  }
  return CORRIDOR_COLOR;
}

export async function buildScene(inputs: SceneInputs): Promise<SceneController> {
  const { container, zones, drones, missions, weatherAlerts, skycells, plannedRoute, env } = inputs;
  const status: SceneStatus = { provider: 'osm', buildings: 'unavailable', terrain: 'ellipsoid', notes: [] };

  let terrainProvider: unknown;
  if (env.ionToken !== null && Cesium.Ion) {
    Cesium.Ion.defaultAccessToken = env.ionToken;
    if (Cesium.createWorldTerrainAsync) {
      try {
        terrainProvider = await Cesium.createWorldTerrainAsync();
        status.terrain = 'ion';
      } catch {
        status.notes.push('Cesium World Terrain unavailable — using an ellipsoid (flat) globe.');
      }
    }
  } else {
    status.notes.push('No Cesium Ion token: terrain is an ellipsoid (set VITE_CESIUM_ION_TOKEN for World Terrain).');
  }

  // PRD FR-D2's ladder, in order: Open3Dhk → Ion OSM Buildings → unavailable.
  let buildingsPrimitive: unknown = null;
  if (env.open3dhkKey !== null) {
    try {
      buildingsPrimitive = await Cesium.Cesium3DTileset.fromUrl(open3dhkTilesetUrl(env.open3dhkKey));
      status.provider = 'open3dhk';
      status.buildings = 'open3dhk';
    } catch {
      // The live tile endpoint redirects (302) or refuses (403) for a missing/expired key,
      // so a failure here is expected and must degrade, not throw (verified against the
      // real service: no key ⇒ 302 to an HTML page, which Cesium cannot parse).
      status.notes.push('Open3Dhk tileset did not load (check VITE_OPEN3DHK_KEY) — falling back.');
    }
  }
  if (buildingsPrimitive === null && env.ionToken !== null && Cesium.createOsmBuildingsAsync) {
    try {
      buildingsPrimitive = await Cesium.createOsmBuildingsAsync();
      status.buildings = 'ion';
      if (status.provider === 'osm') {
        status.provider = 'ion';
      }
    } catch {
      status.notes.push('Cesium OSM Buildings unavailable — buildings toggle disabled.');
    }
  }
  if (buildingsPrimitive === null && status.buildings === 'unavailable') {
    status.notes.push(
      'Buildings unavailable: set VITE_OPEN3DHK_KEY (LandsD) or VITE_CESIUM_ION_TOKEN to load a 3D city model.',
    );
  }

  const viewer = new Cesium.Viewer(container, {
    // `baseLayer: false` + an explicit imagery layer: the modern API, so the OSM fallback
    // needs no token while an Ion-based scene can still be configured later.
    baseLayer: false,
    terrainProvider,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,
  });
  viewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
  if (buildingsPrimitive !== null) {
    viewer.scene.primitives.add(buildingsPrimitive);
  }

  const groups: EntityGroup[] = [
    { layer: 'restrictedZones', entities: [] },
    { layer: 'drones', entities: [] },
    { layer: 'routes', entities: [] },
    { layer: 'trails', entities: [] },
    { layer: 'weather', entities: [] },
    { layer: 'grid', entities: [] },
  ];
  const groupOf = (layer: ThreeDLayerId): EntityGroup => {
    const group = groups.find((candidate) => candidate.layer === layer);
    if (!group) {
      throw new Error(`no entity group for layer ${layer}`);
    }
    return group;
  };

  // ---- RFZ volumes (FR-3D-V3): restricted red, sandbox amber, others cyan.
  // Restricted zones get higher opacity for clear visibility per user requirement.
  for (const zone of zones) {
    const isRestricted = zone.kind === 'rfz' || zone.kind === 'sensitive';
    const alpha = isRestricted ? 0.42 : zone.kind === 'sandbox' ? 0.4 : 0.32;
    const color = Cesium.Color.fromCssColorString(zoneColor(zone.kind)).withAlpha(alpha);
    groupOf('restrictedZones').entities.push(
      viewer.entities.add({
        id: `zone-${zone.id}`,
        name: zone.name,
        description: `${zone.kind.toUpperCase()} · ${zone.restriction}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringToDegrees(zone.polygon))),
          height: 0,
          extrudedHeight: RFZ_VOLUME_HEIGHT_M,
          material: color,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(zoneColor(zone.kind)).withAlpha(isRestricted ? 1.0 : 0.9),
          outlineWidth: isRestricted ? 3 : 2,
        },
      }),
    );
  }

  // ---- Drone markers at altitude (FR-3D-V4), label = callsign + altitude.
  for (const drone of drones) {
    groupOf('drones').entities.push(
      viewer.entities.add({
        id: `drone-${drone.id}`,
        name: drone.callsign,
        description: `${drone.altitudeM} m · ${drone.status} · ${drone.batteryPct}%`,
        position: Cesium.Cartesian3.fromDegrees(drone.position.lng, drone.position.lat, drone.altitudeM),
        cylinder: {
          length: DRONE_GLYPH_LENGTH_M,
          topRadius: DRONE_GLYPH_RADIUS_M,
          bottomRadius: DRONE_GLYPH_RADIUS_M,
          material: Cesium.Color.CYAN.withAlpha(0.9),
        },
        label: {
          text: `${drone.callsign} · ${drone.altitudeM} m`,
          pixelOffset: { x: 0, y: -28 },
        },
      }),
    );
  }

  // ---- Mission corridors (solid) and the planned A* route (dashed, FR-3D-V5 trail).
  for (const mission of missions) {
    if (mission.route.length < 2) {
      continue;
    }
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(
      mission.route.flatMap((point) => [point.lng, point.lat, mission.altitudeWindowM[1]]),
    );
    groupOf('routes').entities.push(
      viewer.entities.add({
        id: `mission-${mission.id}`,
        name: mission.name,
        polyline: { positions, width: 2.5, material: Cesium.Color.WHITE.withAlpha(0.65) },
      }),
    );
  }
  if (plannedRoute !== null && plannedRoute.length >= 2) {
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(
      plannedRoute.flatMap((point) => [point.lng, point.lat, 120]),
    );
    groupOf('trails').entities.push(
      viewer.entities.add({
        id: 'planned-route',
        name: 'Planned route',
        polyline: {
          positions,
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(PLANNED_ROUTE_COLOR),
          }),
        },
      }),
    );
  }

  // ---- Weather: precipitation cell + the cell's wind as a label (FR-3D-V6).
  for (const alert of weatherAlerts) {
    groupOf('weather').entities.push(
      viewer.entities.add({
        id: `weather-${alert.id}`,
        name: alert.type,
        description: `${alert.windKph} km/h @ ${alert.windDirectionDeg}° · ${alert.precipitationMmH} mm/h`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ringToDegrees(alert.area))),
          height: 500,
          material: Cesium.Color.WHITE.withAlpha(0.16),
        },
      }),
    );
    groupOf('weather').entities.push(
      viewer.entities.add({
        id: `weather-wind-${alert.id}`,
        name: `${alert.type} wind`,
        position: Cesium.Cartesian3.fromDegrees(alert.area[0].lng, alert.area[0].lat, 520),
        label: { text: `${alert.windKph} km/h`, pixelOffset: { x: 0, y: -12 } },
      }),
    );
  }

  // ---- Traffic density (PRD S128's "traffic heatmap"): skycell volumes by band.
  // Closed cells get a distinct dark purple volume with higher opacity.
  for (const cell of skycells) {
    const isClosed = cell.closed;
    const baseColor = isClosed ? '#312e81' : bandColor(cell.band);
    const alpha = isClosed ? 0.55 : 0.22;
    const height = isClosed ? 200 : TRAFFIC_VOLUME_HEIGHT_M;
    groupOf('grid').entities.push(
      viewer.entities.add({
        id: `skycell-${cell.id}`,
        name: `Skycell ${cell.row}/${cell.col}${isClosed ? ' (CLOSED)' : ''}`,
        description: isClosed
          ? `CLOSED — flight plans blocked. Risk: ${cell.risk}/100`
          : `occupancy ${(cell.occupancy * 100).toFixed(0)}% (${cell.band}) · risk ${cell.risk}/100 · wind ${cell.windKph} km/h · ${cell.temperatureC}°C`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArray(cell.ring.flatMap(([lng, lat]) => [lng, lat])),
          ),
          height: 0,
          extrudedHeight: height,
          material: Cesium.Color.fromCssColorString(baseColor).withAlpha(alpha),
          outline: isClosed,
          outlineColor: Cesium.Color.fromCssColorString('#818cf8').withAlpha(0.8),
        },
      }),
    );
  }

  // Layer visibility is NOT decided here. The caller applies every flag through
  // `setLayer` as soon as this returns, which keeps one owner for visibility (the panel
  // holding the store flags) instead of two that can disagree after a toggle.

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(114.1694, 22.3193, 5200),
    orientation: { heading: 0, pitch: -0.7, roll: 0 },
  });

  const counts: SceneCounts = {
    rfz: groupOf('restrictedZones').entities.length,
    drones: groupOf('drones').entities.length,
    routes: groupOf('routes').entities.length,
    trails: groupOf('trails').entities.length,
    weather: groupOf('weather').entities.length,
    traffic: groupOf('grid').entities.length,
  };

  return {
    viewer,
    status,
    counts,
    setLayer(layer: ThreeDLayerId, visible: boolean): void {
      const group = groups.find((candidate) => candidate.layer === layer);
      if (group) {
        for (const entity of group.entities) {
          entity.show = visible;
        }
        return;
      }
      if (layer === 'buildings' && buildingsPrimitive !== null) {
        if (visible) {
          viewer.scene.primitives.add(buildingsPrimitive);
        } else {
          viewer.scene.primitives.remove(buildingsPrimitive);
        }
      }
    },
    destroy(): void {
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
    },
  };
}

function bandColor(band: Skycell['band']): string {
  switch (band) {
    case 'congested':
      return '#ef4444';
    case 'busy':
      return '#fb923c';
    case 'light':
      return '#facc15';
    default:
      return '#4ade80';
  }
}
