import type { AirspaceZone, AppState, Drone, Mission, WeatherAlert } from '../types/domain';

/**
 * Adapter seam introduced in M2. A backend supplies the operational state that
 * the M1 shell previously took straight from the mock module. The frontend
 * still runs with zero network access: the default backend is the mock replay,
 * and the CAD backend layers the ingested GeoJSON zones on top of it.
 */
export interface DataBackend {
  readonly id: BackendId;
  /** Human label for the source selector UI. */
  readonly label: string;
  /** True when the backend never touches the network. */
  readonly offlineCapable: boolean;
  /** True when the backend is backed by ingested regulatory geodata. */
  readonly usesIngestedGeodata: boolean;
  loadInitialState(): AppState;
  loadZones(): AirspaceZone[];
  simulateTick(state: AppState): AppState;
  listZones(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): AirspaceZone[];
  loadFleet(): Drone[];
  loadMissions(): Mission[];
  loadWeatherAlerts(): WeatherAlert[];
}
export type BackendId = 'mock' | 'cad-geojson';

