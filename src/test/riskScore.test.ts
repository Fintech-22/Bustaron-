import { describe, expect, it } from 'vitest';
import { computeRiskScore } from '../services/riskScore';
import type { Drone, WeatherAlert, AirspaceZone } from '../types/domain';

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

function makeZone(overrides: Partial<AirspaceZone> = {}): AirspaceZone {
  return {
    id: 'zone-1',
    name: 'Test Zone',
    kind: 'rfz',
    polygon: [{ lat: 22.3, lng: 114.17 }, { lat: 22.31, lng: 114.17 }, { lat: 22.31, lng: 114.18 }],
    restriction: 'No flight',
    riskLevel: 'low',
    ...overrides,
  };
}

function makeAlert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'alert-1',
    type: 'wind',
    severity: 'medium',
    area: [{ lat: 22.3, lng: 114.17 }, { lat: 22.31, lng: 114.17 }, { lat: 22.31, lng: 114.18 }],
    windKph: 20,
    windDirectionDeg: 90,
    precipitationMmH: 0,
    validUntil: '2026-01-01T12:00:00Z',
    ...overrides,
  };
}

describe('risk score computation (STAGE 4)', () => {
  it('returns a score 0–100', () => {
    const result = computeRiskScore({
      drones: [],
      weatherAlerts: [],
      zones: [],
      closedCellCount: 0,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('returns Low risk with green color for minimal threats', () => {
    const result = computeRiskScore({
      drones: [makeDrone()],
      weatherAlerts: [],
      zones: [],
      closedCellCount: 0,
    });
    expect(result.label).toBe('Low');
    expect(result.color).toBe('#4ade80');
  });

  it('elevates risk with high wind', () => {
    const result = computeRiskScore({
      drones: [makeDrone()],
      weatherAlerts: [makeAlert({ windKph: 70 })],
      zones: [],
      closedCellCount: 0,
    });
    expect(result.score).toBeGreaterThan(25);
    expect(result.factors.wind).toBeGreaterThan(50);
  });

  it('elevates risk with warning drones', () => {
    const result = computeRiskScore({
      drones: [makeDrone({ status: 'warning' }), makeDrone({ id: 'd2', status: 'critical' })],
      weatherAlerts: [],
      zones: [],
      closedCellCount: 0,
    });
    expect(result.factors.drones).toBe(100);
    expect(result.score).toBeGreaterThan(0);
  });

  it('elevates risk with high/critical zones', () => {
    const result = computeRiskScore({
      drones: [],
      weatherAlerts: [],
      zones: [makeZone({ riskLevel: 'critical' }), makeZone({ id: 'z2', riskLevel: 'high' })],
      closedCellCount: 0,
    });
    expect(result.factors.zones).toBe(20);
  });

  it('elevates risk with closed cells', () => {
    const result = computeRiskScore({
      drones: [],
      weatherAlerts: [],
      zones: [],
      closedCellCount: 10,
    });
    expect(result.factors.closures).toBe(50);
  });

  it('produces High risk label for severe conditions', () => {
    const result = computeRiskScore({
      drones: [makeDrone({ status: 'critical' })],
      weatherAlerts: [makeAlert({ windKph: 80 })],
      zones: [makeZone({ riskLevel: 'critical' })],
      closedCellCount: 20,
    });
    expect(result.label).toBe('High');
    expect(result.color).toBe('#ef4444');
  });

  it('is deterministic — same input produces same output', () => {
    const input = {
      drones: [makeDrone({ status: 'warning' })],
      weatherAlerts: [makeAlert({ windKph: 40 })],
      zones: [makeZone({ riskLevel: 'high' })],
      closedCellCount: 5,
    };
    const a = computeRiskScore(input);
    const b = computeRiskScore(input);
    expect(a).toEqual(b);
  });
});
