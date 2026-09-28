import { describe, expect, it } from 'vitest';
import { buildSkycells, skycellBandColor, skycellsToGeoJson, classifyRisk } from '../services/skycells';
import type { Drone, Mission } from '../types/domain';

const drone = (over: Partial<Drone> = {}): Drone => ({
  id: 'd1',
  callsign: 'T-01',
  operatorId: 'wallet-harbour',
  position: { lat: 22.3, lng: 114.17 },
  altitudeM: 100,
  status: 'nominal',
  batteryPct: 80,
  missionId: 'm1',
  headingDeg: 0,
  speedKph: 30,
  lastSeenIso: '2026-09-26T00:00:00Z',
  ...over,
});

const mission = (route: Mission['route']): Mission => ({
  id: 'm1',
  name: 'Test mission',
  operator: 'Ops',
  route,
  status: 'active',
  riskLevel: 'medium',
  altitudeWindowM: [80, 160],
  etaIso: '2026-09-26T01:00:00Z',
});

const HK_MIN_LAT = 22.15;
const HK_MIN_LNG = 113.82;
const CELL_SIZE_M = 500;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((22.35 * Math.PI) / 180);

describe('skycell lattice', () => {
  it('covers the full HK operating area with 500 m cells', () => {
    const cells = buildSkycells([drone()], [mission([{ lat: 22.28, lng: 114.15 }, { lat: 22.32, lng: 114.2 }])]);
    expect(cells.length).toBeGreaterThan(1000);
    const latSpans = cells.filter((cell) => cell.row === 0).length;
    expect(latSpans).toBeGreaterThan(50);
    // Every ring is a 4-point polygon.
    for (const cell of cells.slice(0, 10)) {
      expect(cell.ring).toHaveLength(4);
    }
  });

  it('is deterministic for identical state', () => {
    const drones = [drone(), drone({ id: 'd2', position: { lat: 22.33, lng: 114.2 }, status: 'critical' })];
    const missions = [mission([{ lat: 22.28, lng: 114.15 }, { lat: 22.32, lng: 114.2 }])];
    expect(buildSkycells(drones, missions)).toEqual(buildSkycells(drones, missions));
  });

  it('raises occupancy near drones and routes, and bands accordingly', () => {
    const quiet = buildSkycells([], []);
    const busy = buildSkycells(
      [
        drone(),
        drone({ id: 'd2', position: { lat: 22.3, lng: 114.17 }, status: 'critical' }),
        drone({ id: 'd3', position: { lat: 22.301, lng: 114.171 } }),
      ],
      [mission([{ lat: 22.3, lng: 114.17 }, { lat: 22.301, lng: 114.171 }])],
    );
    // Compute the cell ID that covers lat=22.3, lng=114.17 using the new bounds
    const row = Math.floor((22.3 - HK_MIN_LAT) / (CELL_SIZE_M / M_PER_DEG_LAT));
    const col = Math.floor((114.17 - HK_MIN_LNG) / (CELL_SIZE_M / M_PER_DEG_LNG));
    const centreId = `cell-${row}-${col}`;
    const quietCell = quiet.find((cell) => cell.id === centreId);
    const busyCell = busy.find((cell) => cell.id === centreId);
    expect(quietCell).toBeDefined();
    expect(busyCell).toBeDefined();
    expect(busyCell!.occupancy).toBeGreaterThan(quietCell!.occupancy);
    expect(busyCell!.occupancy).toBeGreaterThan(0.3);
    // Band thresholds match the PRD colors.
    expect(skycellBandColor.congested).toBe('#ef4444');
    expect(skycellBandColor.clear).toBe('#4ade80');
  });

  it('serialises to a GeoJSON FeatureCollection with band and risk properties', () => {
    const geo = skycellsToGeoJson(buildSkycells([drone()], [])) as {
      type: string;
      features: {
        properties: {
          band: string;
          occupancy: number;
          risk: number;
          riskClass: string;
          closed: boolean;
          windKph: number;
          temperatureC: number;
          areaKm2: number;
          populationPerKm2: number;
        };
        geometry: { coordinates: number[][][] };
      }[];
    };
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features.length).toBeGreaterThan(1000);
    const first = geo.features[0];
    expect(typeof first.properties.occupancy).toBe('number');
    expect(['clear', 'light', 'busy', 'congested']).toContain(first.properties.band);
    expect(typeof first.properties.risk).toBe('number');
    expect(first.properties.risk).toBeGreaterThanOrEqual(0);
    expect(first.properties.risk).toBeLessThanOrEqual(100);
    expect(typeof first.properties.closed).toBe('boolean');
    expect(first.geometry.coordinates[0]).toHaveLength(5);
  });

  it('computes risk from weather, occupancy, and population', () => {
    const cells = buildSkycells(
      [drone()],
      [mission([{ lat: 22.3, lng: 114.17 }, { lat: 22.301, lng: 114.171 }])],
      [],
      new Set(),
      [],
    );
    // Cells in the harbour area should have population density
    const harbourCell = cells.find(
      (c) => c.center.lat > 22.28 && c.center.lat < 22.32 && c.center.lng > 114.15 && c.center.lng < 114.19,
    );
    expect(harbourCell).toBeDefined();
    expect(harbourCell!.risk).toBeGreaterThanOrEqual(0);
    expect(harbourCell!.risk).toBeLessThanOrEqual(100);
    expect(harbourCell!.windKph).toBeGreaterThan(0);
    expect(harbourCell!.temperatureC).toBeGreaterThan(15);
    expect(harbourCell!.areaKm2).toBeCloseTo(0.25, 1);
  });

  it('pins closed cells to risk 100', () => {
    const row = Math.floor((22.3 - HK_MIN_LAT) / (CELL_SIZE_M / M_PER_DEG_LAT));
    const col = Math.floor((114.17 - HK_MIN_LNG) / (CELL_SIZE_M / M_PER_DEG_LNG));
    const cellId = `cell-${row}-${col}`;
    const closed = new Set([cellId]);
    const cells = buildSkycells([drone()], [], [], closed, []);
    const target = cells.find((c) => c.id === cellId);
    expect(target).toBeDefined();
    expect(target!.closed).toBe(true);
    expect(target!.risk).toBe(100);
  });

  it('classifies risk into low/medium/high/critical', () => {
    expect(classifyRisk(0)).toBe('low');
    expect(classifyRisk(24)).toBe('low');
    expect(classifyRisk(25)).toBe('medium');
    expect(classifyRisk(49)).toBe('medium');
    expect(classifyRisk(50)).toBe('high');
    expect(classifyRisk(74)).toBe('high');
    expect(classifyRisk(75)).toBe('critical');
    expect(classifyRisk(100)).toBe('critical');
  });
});
