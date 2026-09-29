import { describe, expect, it } from 'vitest';
import { buildSkyOccupancy24h, peakOccupancy, meanOccupancy } from '../services/skyOccupancy';
import type { Drone, Mission } from '../types/domain';

function makeDrone(overrides: Partial<Drone> = {}): Drone {
  return {
    id: 'drone-1',
    callsign: 'D1',
    operatorId: 'wallet-harbour',
    position: { lat: 22.3, lng: 114.17 },
    altitudeM: 120,
    status: 'nominal',
    batteryPct: 85,
    missionId: 'm1',
    headingDeg: 0,
    speedKph: 30,
    lastSeenIso: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    name: 'Test Mission',
    operator: 'Harbour Logistics',
    route: [{ lat: 22.3, lng: 114.17 }, { lat: 22.32, lng: 114.19 }],
    status: 'active',
    riskLevel: 'low',
    altitudeWindowM: [80, 160],
    etaIso: '2026-01-01T10:00:00Z',
    ...overrides,
  };
}

describe('sky occupancy 24h model (STAGE 4)', () => {
  it('produces exactly 24 hourly data points', () => {
    const points = buildSkyOccupancy24h([], []);
    expect(points).toHaveLength(24);
    expect(points[0].hour).toBe(0);
    expect(points[23].hour).toBe(23);
  });

  it('each point has occupancy 0–100 and non-negative sorties', () => {
    const drones = [makeDrone(), makeDrone({ id: 'd2', speedKph: 0, status: 'grounded' })];
    const missions = [makeMission()];
    const points = buildSkyOccupancy24h(drones, missions);
    for (const p of points) {
      expect(p.occupancy).toBeGreaterThanOrEqual(0);
      expect(p.occupancy).toBeLessThanOrEqual(100);
      expect(p.sorties).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic — same input produces same output', () => {
    const drones = [makeDrone()];
    const missions = [makeMission()];
    const a = buildSkyOccupancy24h(drones, missions);
    const b = buildSkyOccupancy24h(drones, missions);
    expect(a).toEqual(b);
  });

  it('empty fleet produces the diurnal baseline only', () => {
    const points = buildSkyOccupancy24h([], []);
    // Night hours should be very low
    expect(points[2].occupancy).toBeLessThan(5);
    // Midday should be higher
    expect(points[12].occupancy).toBeGreaterThan(points[2].occupancy);
  });

  it('active missions boost the hours they are scheduled in', () => {
    const etaIso = '2026-01-01T10:00:00Z';
    const missions = [makeMission({ etaIso, status: 'scheduled' })];
    const withMissions = buildSkyOccupancy24h([], missions);
    const withoutMissions = buildSkyOccupancy24h([], []);
    // Compute the local hour the ETA maps to (timezone-independent).
    const etaHour = new Date(etaIso).getHours();
    expect(withMissions[etaHour].occupancy).toBeGreaterThan(withoutMissions[etaHour].occupancy);
  });

  it('peakOccupancy returns the max value across the series', () => {
    const points = buildSkyOccupancy24h([makeDrone()], [makeMission()]);
    const peak = peakOccupancy(points);
    const max = Math.max(...points.map((p) => p.occupancy));
    expect(peak).toBe(max);
  });

  it('meanOccupancy returns the rounded average', () => {
    const points = buildSkyOccupancy24h([], []);
    const mean = meanOccupancy(points);
    const expected = Math.round(points.reduce((s, p) => s + p.occupancy, 0) / points.length);
    expect(mean).toBe(expected);
  });
});
