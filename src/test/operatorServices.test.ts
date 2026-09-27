import { describe, expect, it } from 'vitest';
import { buildAnalyticsReport } from '../services/analytics';
import { deriveAlerts, pendingAlertCount } from '../services/alerts';
import { buildCreditSeries } from '../services/creditSeries';
import { buildEsgReport } from '../services/esg';
import { fleetStatusOf, formatUtcDate, maintenanceDueIso } from '../services/fleet';
import { MOCK_CLOCK_ISO, mockCreditLedger, mockDrones, mockMissions, mockWeatherAlerts, mockZones } from '../data/mockData';
import type { Alert, Drone } from '../types/domain';

describe('ESG scorecard (PRD §11.2.2)', () => {
  it('derives carbon, compliance, privacy, recycling and multiplier from state', () => {
    const report = buildEsgReport(mockDrones, mockMissions, mockZones);

    expect(report.carbonPerKmG).toBeGreaterThan(0);
    expect(report.carbonPerKmG).toBeLessThanOrEqual(80);
    expect(report.totalDistanceKm).toBeGreaterThan(0);
    expect(report.totalMissions).toBe(mockMissions.length);
    expect(report.complianceRatePct).toBe(100);
    expect(report.privacyViolations).toBe(0);
    expect(report.recyclingScorePct).toBeGreaterThan(0);
    expect(report.esgMultiplier).toBeGreaterThanOrEqual(1);
    expect(report.esgMultiplier).toBeLessThanOrEqual(1.3);
    expect(report.grade).toBe('A');
    expect(report.noiseByZone.length).toBeGreaterThan(0);
  });

  it('flags a sensitive-zone overflight as a privacy violation', () => {
    const overflight = mockMissions[0];
    const sensitive = { ...mockZones[1], polygon: overflight.route.map((point) => ({ ...point })) };
    const report = buildEsgReport(mockDrones, [overflight], [sensitive]);
    expect(report.privacyViolations).toBeGreaterThan(0);
    expect(report.grade).not.toBe('A');
  });
});

describe('fleet view model (PRD S114)', () => {
  const drone = (patch: Partial<Drone>): Drone => ({
    id: 'd',
    callsign: 'D',
    operatorId: 'wallet-harbour',
    position: { lat: 22.3, lng: 114.17 },
    altitudeM: 100,
    status: 'nominal',
    batteryPct: 90,
    missionId: 'mission-x',
    headingDeg: 0,
    speedKph: 30,
    lastSeenIso: '2026-09-24T13:35:00.000Z',
    ...patch,
  });

  it('classifies idle, flying and maintenance', () => {
    expect(fleetStatusOf(drone({ status: 'grounded' }))).toBe('maintenance');
    expect(fleetStatusOf(drone({ batteryPct: 10 }))).toBe('maintenance');
    expect(fleetStatusOf(drone({ missionId: 'mission-standby' }))).toBe('idle');
    expect(fleetStatusOf(drone({}))).toBe('flying');
  });

  it('matches the seeded mock fleet', () => {
    expect(fleetStatusOf(mockDrones[0])).toBe('flying');
    expect(fleetStatusOf(mockDrones[3])).toBe('maintenance');
  });

  it('produces a deterministic maintenance date and formats it', () => {
    const due = maintenanceDueIso(mockDrones[0]);
    expect(due).toBe(maintenanceDueIso(mockDrones[0]));
    expect(formatUtcDate(due)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatUtcDate('')).toBe('—');
  });
});

describe('analytics report (PRD §11.2.2)', () => {
  it('builds a personal heatmap, efficiency metrics and a cost analysis', () => {
    const report = buildAnalyticsReport(mockDrones, mockMissions, mockZones, 'Harbour Ops Desk');

    expect(report.heatmap.length).toBeGreaterThan(0);
    expect(report.maxOccupancy).toBeGreaterThan(0);
    expect(report.hotSpots.length).toBeGreaterThan(0);
    expect(report.efficiency.sorties).toBe(1);
    expect(report.efficiency.totalDistanceKm).toBeGreaterThan(0);
    expect(report.efficiency.utilisationPct).toBeGreaterThanOrEqual(0);
    expect(report.cost.totalRouteCredits).toBeGreaterThan(0);
    expect(report.cost.creditsPerKm).toBeGreaterThan(0);
    expect(report.cost.projectedMonthlyCredits).toBe(report.cost.totalRouteCredits * 30);
  });

  it('covers the whole system when no operator is given', () => {
    const report = buildAnalyticsReport(mockDrones, mockMissions, mockZones, null);
    expect(report.efficiency.sorties).toBe(mockMissions.length);
  });
});

describe('credit series (PRD S113)', () => {
  it('buckets the ledger into 30 days with an earned/spent breakdown', () => {
    const series = buildCreditSeries(mockCreditLedger, null, MOCK_CLOCK_ISO);
    expect(series.days).toHaveLength(30);
    expect(series.earnedTotal).toBeGreaterThan(0);
    expect(series.spentTotal).toBeGreaterThan(0);
    expect(series.netTotal).toBe(series.earnedTotal - series.spentTotal);
    expect(series.peak).toBeGreaterThan(0);
  });

  it('scopes to one wallet', () => {
    const scoped = buildCreditSeries(mockCreditLedger, 'wallet-harbour', MOCK_CLOCK_ISO);
    const all = buildCreditSeries(mockCreditLedger, null, MOCK_CLOCK_ISO);
    expect(scoped.earnedTotal).toBeLessThan(all.earnedTotal);
  });
});

describe('alert derivation (PRD S115)', () => {
  it('derives drone and weather alerts with severities and sources', () => {
    const alerts: Alert[] = deriveAlerts(mockDrones, mockWeatherAlerts, MOCK_CLOCK_ISO);
    // 3 drone alerts (watch + battery on BSN-07, grounded on BSN-15) + 2 weather cells.
    expect(alerts.length).toBe(3 + mockWeatherAlerts.length);
    expect(alerts.every((alert) => alert.id.length > 0 && alert.sourceDrone.length > 0 && alert.atIso.length > 0)).toBe(true);
    expect(alerts.some((alert) => alert.type === 'Battery low')).toBe(true);
    expect(alerts.some((alert) => alert.severity === 'critical')).toBe(true);
    // Drone alerts are grouped first (severity-ordered); weather cells follow.
    expect(alerts[0].sourceDroneId).not.toBe('');
    expect(alerts[alerts.length - 1].severity).toBe('critical');
    expect(pendingAlertCount(alerts)).toBe(alerts.length);
    expect(pendingAlertCount(alerts.map((alert) => ({ ...alert, acknowledged: true })))).toBe(0);
  });
});
