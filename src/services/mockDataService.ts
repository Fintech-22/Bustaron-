import { initialMockState } from '../data/mockData';
import type { AppState, Drone } from '../types/domain';

const TICK_MINUTES = 1;

/** Provides deterministic mock data for the M1 frontend shell. */
export class MockDataService {
  /** Loads a defensive copy of the initial frontend-only state. */
  loadInitialState(): AppState {
    return structuredClone(initialMockState);
  }

  /** Advances mock drone positions slightly without relying on any backend. */
  simulateTick(state: AppState): AppState {
    const nextTimestamp = new Date(state.lastUpdatedIso);
    nextTimestamp.setUTCMinutes(nextTimestamp.getUTCMinutes() + TICK_MINUTES);

    const drones: Drone[] = state.drones.map((drone: Drone): Drone => {
      if (drone.status === 'grounded') {
        return { ...drone, lastSeenIso: nextTimestamp.toISOString() };
      }

      const headingRad = (drone.headingDeg * Math.PI) / 180;
      const driftLat = Math.cos(headingRad) * 0.0012;
      const driftLng = Math.sin(headingRad) * 0.0015;
      const nextBatteryPct = Math.max(12, drone.batteryPct - (drone.status === 'warning' ? 2 : 1));

      return {
        ...drone,
        batteryPct: nextBatteryPct,
        position: {
          lat: Number((drone.position.lat + driftLat).toFixed(6)),
          lng: Number((drone.position.lng + driftLng).toFixed(6)),
        },
        lastSeenIso: nextTimestamp.toISOString(),
      };
    });

    return {
      ...state,
      drones,
      lastUpdatedIso: nextTimestamp.toISOString(),
    };
  }
}

export const mockDataService = new MockDataService();
