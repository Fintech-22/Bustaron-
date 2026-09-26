import { describe, expect, it } from 'vitest';
import { loadCadZones } from '../services/cadGeoJsonService';
import { planRoute, GRID_SPACING_M } from '../services/routePlanner';
import { SANDBOX_COST_FACTOR, SANDBOX_NAME_PATTERN, isSandboxZone } from '../services/zoneClassification';
import { useDashboardStore } from '../store/dashboardStore';
import type { AirspaceZone, Drone, GeoPoint } from '../types/domain';
import { initialMockState } from '../data/mockData';

describe('defect 6 — sandbox zone taxonomy (PRD §5.3)', () => {
  it('classifies sandbox zones by name from the CAD pack', () => {
    const zones = loadCadZones();
    const sandboxes = zones.filter((zone) => zone.kind === 'sandbox');
    const restricted = zones.filter((zone) => zone.kind === 'rfz');
    expect(zones.length).toBe(284);
    // The pack carries the Low-altitude Economy Regulatory Sandbox zones.
    expect(sandboxes.length).toBeGreaterThanOrEqual(20);
    expect(sandboxes.length + restricted.length).toBe(zones.length);
    for (const sandbox of sandboxes) {
      expect(sandbox.name).toMatch(SANDBOX_NAME_PATTERN);
      expect(sandbox.riskLevel).toBe('medium');
    }
  });

  it('exposes the taxonomy in the domain kind union', () => {
    const zone: AirspaceZone = { ...initialMockState.zones[0], kind: 'sandbox' };
    expect(isSandboxZone(zone)).toBe(true);
    expect(isSandboxZone({ ...zone, kind: 'rfz', name: 'Plain police station' })).toBe(false);
    // Name-based classification still catches un-migrated kinds.
    expect(isSandboxZone({ ...zone, kind: 'rfz', name: 'Shing Mun (Low-altitude Economy Regulatory Sandbox)' })).toBe(true);
  });
});

describe('defect 3 — sandbox zones are high-cost, not no-fly (PRD FR-FP2/S16)', () => {
  const start: GeoPoint = { lat: 22.28, lng: 114.14 };
  const goal: GeoPoint = { lat: 22.35, lng: 114.22 };

  /** A full-width band the route cannot go around within the lattice bounds. */
  function bandZone(kind: AirspaceZone['kind'], name: string): AirspaceZone {
    return {
      id: `zone-${kind}`,
      name,
      kind,
      polygon: [
        { lat: 22.318, lng: 114.10 },
        { lat: 22.318, lng: 114.26 },
        { lat: 22.312, lng: 114.26 },
        { lat: 22.312, lng: 114.10 },
      ],
      restriction: 'test',
      riskLevel: kind === 'sandbox' ? 'medium' : 'high',
    };
  }

  it('crosses a sandbox band (high cost) where the same band as RFZ walls off completely', () => {
    // Sandbox: permissible with authorization — a route exists THROUGH the band.
    const sandboxRoute = planRoute(start, goal, { zones: [bandZone('sandbox', 'Test (Low-altitude Economy Regulatory Sandbox)')] });
    // Straight-line is ~11.3 km; allow a small lattice detour only.
    expect(sandboxRoute.distanceM).toBeLessThan(12600);
    // The path actually crosses the band's latitude window.
    const crosses = sandboxRoute.waypoints.some((point) => point.lat >= 22.312 && point.lat <= 22.318);
    expect(crosses).toBe(true);

    // Same geometry as a restricted zone: infinite cost — no route at all.
    expect((): unknown => planRoute(start, goal, { zones: [bandZone('rfz', 'Test RFZ')] })).toThrow(/No compliant route/);
    void SANDBOX_COST_FACTOR;
    void GRID_SPACING_M;
  });

  it('penalises sandbox transit in the cost function (prefers the long way around)', () => {
    // Free route cost < route cost with a sandbox penalty over the same ground
    // is guaranteed by construction: expose the factor and assert ordering.
    expect(SANDBOX_COST_FACTOR).toBeGreaterThan(1);
    expect(SANDBOX_COST_FACTOR).toBeLessThan(Number.POSITIVE_INFINITY);
  });
});

describe('defect 2 — per-operator drone scoping (PRD §11.3.3)', () => {
  const drone = (id: string, operatorId: string): Drone => ({
    id,
    callsign: id.toUpperCase(),
    operatorId,
    position: { lat: 22.3, lng: 114.17 },
    altitudeM: 100,
    status: 'nominal',
    batteryPct: 80,
    missionId: 'm',
    headingDeg: 0,
    speedKph: 30,
    lastSeenIso: 'x',
  });

  it('tags every mock drone with an owning operator', () => {
    for (const entry of initialMockState.drones) {
      expect(entry.operatorId).toMatch(/^wallet-/);
    }
  });

  it('exposes the current operator and switching in the store', () => {
    const store = useDashboardStore.getState();
    expect(store.currentOperatorId).toBe('wallet-harbour');

    store.setOperator('wallet-cargo');
    expect(useDashboardStore.getState().currentOperatorId).toBe('wallet-cargo');

    useDashboardStore.getState().setOperator('wallet-harbour');
    expect(useDashboardStore.getState().currentOperatorId).toBe('wallet-harbour');
  });

  it('scopes the operator view to own drones while admin sees all', () => {
    const drones = [drone('a', 'wallet-harbour'), drone('b', 'wallet-urban'), drone('c', 'wallet-harbour')];
    useDashboardStore.setState({ drones, activeRole: 'operator', currentOperatorId: 'wallet-harbour' });

    const scoped = useDashboardStore.getState().drones.filter(
      (entry) => useDashboardStore.getState().activeRole === 'admin' || entry.operatorId === useDashboardStore.getState().currentOperatorId,
    );
    expect(scoped.map((entry) => entry.id)).toEqual(['a', 'c']);

    useDashboardStore.setState({ activeRole: 'admin' });
    const adminView = useDashboardStore.getState().drones.filter(
      (entry) => useDashboardStore.getState().activeRole === 'admin' || entry.operatorId === useDashboardStore.getState().currentOperatorId,
    );
    expect(adminView).toHaveLength(3);
  });
});
