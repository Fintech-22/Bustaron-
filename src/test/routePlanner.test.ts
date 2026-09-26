import { describe, expect, it } from 'vitest';
import { planRoute, GRID_SPACING_M } from '../services/routePlanner';
import type { AirspaceZone, GeoPoint } from '../types/domain';
import { haversineM } from '../services/geo/pointInPolygon';

function squareRfz(lat: number, lng: number, sideDeg: number): AirspaceZone {
  const half = sideDeg / 2;
  return {
    id: 'rfz-test',
    name: 'Test RFZ',
    kind: 'rfz',
    polygon: [
      { lat: lat + half, lng: lng - half },
      { lat: lat + half, lng: lng + half },
      { lat: lat - half, lng: lng + half },
      { lat: lat - half, lng: lng - half },
    ],
    restriction: 'test',
    riskLevel: 'high',
  };
}

function corridorZone(lat: number, lng: number, sideDeg: number): AirspaceZone {
  return { ...squareRfz(lat, lng, sideDeg), id: 'corridor-test', kind: 'corridor', riskLevel: 'low' };
}

describe('planRoute', () => {
  const start: GeoPoint = { lat: 22.28, lng: 114.14 };
  const goal: GeoPoint = { lat: 22.35, lng: 114.22 };

  it('returns a clear route when no zones exist', () => {
    const route = planRoute(start, goal, { zones: [] });
    expect(route.clearOfRestrictedZones).toBe(true);
    expect(route.waypoints[0]).toEqual(start);
    expect(route.waypoints[route.waypoints.length - 1]).toEqual(goal);
    expect(route.distanceM).toBeGreaterThan(haversineM(start, goal) * 0.9);
    expect(route.distanceM).toBeLessThan(haversineM(start, goal) * 1.6);
    expect(route.nodesExpanded).toBeGreaterThan(0);
  });

  it('routes around an RFZ between start and goal', () => {
    // Square sitting roughly on the straight line start→goal.
    const blockage = squareRfz(22.315, 114.18, 0.03);
    const route = planRoute(start, goal, { zones: [blockage] });
    expect(route.clearOfRestrictedZones).toBe(true);
    // Detour must be longer than the unobstructed run.
    const clear = planRoute(start, goal, { zones: [] });
    expect(route.distanceM).toBeGreaterThan(clear.distanceM);
    // No waypoint may sit inside the blocking polygon.
    for (const waypoint of route.waypoints) {
      const inside =
        waypoint.lat < 22.33 &&
        waypoint.lat > 22.3 &&
        waypoint.lng > 114.165 &&
        waypoint.lng < 114.195;
      expect(inside).toBe(false);
    }
  });

  it('throws when start is deep inside a restricted zone with no nearby free node', () => {
    // Large enough that the nearest free node is beyond the 2-step fallback.
    const zone = squareRfz(start.lat, start.lng, 0.12);
    expect(() => planRoute(start, goal, { zones: [zone] })).toThrow(/restricted/i);
  });

  it('recovers when start is near but not inside a zone edge', () => {
    // Start just outside a small zone: snapping may land on a blocked node,
    // but the nearest-free-node fallback must still find a route.
    const zone = squareRfz(start.lat + 0.008, start.lng + 0.008, 0.012);
    const route = planRoute(start, goal, { zones: [zone] });
    expect(route.clearOfRestrictedZones).toBe(true);
  });

  it('throws when no path exists (goal walled inside a large zone)', () => {
    const wall = squareRfz(22.315, 114.18, 0.28);
    expect(() => planRoute(start, goal, { zones: [wall] })).toThrow(/No compliant route/i);
  });

  it('discounts corridor waypoints in the corridor metric', () => {
    const corridor = corridorZone(22.315, 114.18, 0.04);
    const throughCorridor = planRoute(start, goal, { zones: [corridor], marginM: 0 });
    expect(throughCorridor.corridorDistanceM).toBeGreaterThan(0);
  });

  it('honours a custom grid spacing without breaking connectivity', () => {
    const route = planRoute(start, goal, { zones: [], spacingM: GRID_SPACING_M * 2 });
    expect(route.clearOfRestrictedZones).toBe(true);
    expect(route.distanceM).toBeGreaterThan(0);
  });
});
