import type { AirspaceZone, AppState, Drone, Mission, WeatherAlert } from '../types/domain';
import { loadCadZones, loadCadZonesIntersecting } from './cadGeoJsonService';
import type { BackendId, DataBackend } from './dataBackend';
import { M3Backend } from './m3Backend';
import { MockDataService } from './mockDataService';

const backendRegistry = new Map<BackendId, DataBackend>();

/** Composes a full AppState from parts, stamping a consistent update time. */
function composeState(
  base: Omit<AppState, 'lastUpdatedIso' | 'zones'>,
  zones: AirspaceZone[],
  lastUpdatedIso: string,
): AppState {
  return {
    ...base,
    zones,
    lastUpdatedIso,
  };
}

/**
 * M1 mock replay backend. Purely in-memory, deterministic, offline. Kept as
 * the default so the app runs unchanged with no network and no geodata.
 * Includes the full CAD RFZ pack so restricted zones are always visible.
 */
export class MockBackend implements DataBackend {
  readonly id = 'mock' as const;
  readonly label = 'Mock replay + CAD RFZ (offline demo)';
  readonly offlineCapable = true;
  readonly usesIngestedGeodata = true;

  private readonly mockService = new MockDataService();

  loadInitialState(): AppState {
    const mockState = this.mockService.loadInitialState();
    const { zones, ...base } = mockState;
    void zones;
    return composeState(base, this.loadZones(), mockState.lastUpdatedIso);
  }

  loadZones(): AirspaceZone[] {
    return loadCadZones();
  }

  listZones(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): AirspaceZone[] {
    return loadCadZonesIntersecting(bounds);
  }

  loadFleet(): Drone[] {
    return this.mockService.loadInitialState().drones;
  }

  loadMissions(): Mission[] {
    return this.mockService.loadInitialState().missions;
  }

  loadWeatherAlerts(): WeatherAlert[] {
    return this.mockService.loadInitialState().weatherAlerts;
  }

  simulateTick(state: AppState): AppState {
    const ticked = this.mockService.simulateTick(state);
    const { zones, ...base } = ticked;
    void zones;
    return composeState(base, this.loadZones(), ticked.lastUpdatedIso);
  }
}

/**
 * CAD GeoJSON backend: the ingested CAD RFZ pack replaces the three schematic
 * mock zones with the real CAD-designated polygons; fleet, missions and
 * weather remain the mock replay until M3 wires live feeds.
 */
export class CadGeoJsonBackend implements DataBackend {
  readonly id = 'cad-geojson' as const;
  readonly offlineCapable = true;
  readonly usesIngestedGeodata = true;

  private cachedZoneCount: number | undefined;

  /**
   * Zone count is derived from the data rather than hardcoded, so regenerating
   * `cadRfzData.json` can never leave a stale count in the UI again.
   */
  get label(): string {
    if (this.cachedZoneCount === undefined) {
      this.cachedZoneCount = loadCadZones().length;
    }
    return `CAD RFZ GeoJSON (${this.cachedZoneCount} zones)`;
  }

  private readonly mockService = new MockDataService();

  loadInitialState(): AppState {
    const mockState = this.mockService.loadInitialState();
    const { zones, ...base } = mockState;
    void zones;
    return composeState(base, this.loadZones(), mockState.lastUpdatedIso);
  }

  loadZones(): AirspaceZone[] {
    return loadCadZones();
  }

  listZones(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): AirspaceZone[] {
    return loadCadZonesIntersecting(bounds);
  }

  loadFleet(): Drone[] {
    return this.mockService.loadInitialState().drones;
  }

  loadMissions(): Mission[] {
    return this.mockService.loadInitialState().missions;
  }

  loadWeatherAlerts(): WeatherAlert[] {
    return this.mockService.loadInitialState().weatherAlerts;
  }

  simulateTick(state: AppState): AppState {
    const ticked = this.mockService.simulateTick(state);
    const { zones, ...base } = ticked;
    void zones;
    return composeState(base, this.loadZones(), ticked.lastUpdatedIso);
  }
}

const mockBackend = new MockBackend();
const cadBackend = new CadGeoJsonBackend();
const m3Backend = new M3Backend();

backendRegistry.set(mockBackend.id, mockBackend);
backendRegistry.set(cadBackend.id, cadBackend);
backendRegistry.set(m3Backend.id, m3Backend);

/** All selectable backends, in UI order. */
export function listBackends(): DataBackend[] {
  return [mockBackend, cadBackend, m3Backend];
}

/** Resolves a backend by id; falls back to the offline mock replay. */
export function resolveBackend(id: string | null | undefined): DataBackend {
  if (id === 'cad-geojson') {
    return cadBackend;
  }
  if (id === 'm3-server') {
    return m3Backend;
  }
  return mockBackend;
}

export const defaultBackendId: BackendId = 'mock';
