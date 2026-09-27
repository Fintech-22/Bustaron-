import type { Alert, AlertSeverity, Drone, RiskLevel, WeatherAlert } from '../types/domain';

/**
 * Real-time alert feed model (PRD S115). Alerts are DERIVED from the live
 * operational state — aircraft health, battery state and weather cells — rather
 * than stored as a second source of truth, so the feed can never drift from the
 * fleet it describes. Acknowledgements are the only persisted bit and are keyed
 * by the deterministic alert id, so a re-derivation preserves them.
 */

/** Battery percentage at or below which a watch alert is raised. */
export const LOW_BATTERY_PCT = 40;

function severityForRisk(risk: RiskLevel): AlertSeverity {
  if (risk === 'critical' || risk === 'high') {
    return 'critical';
  }
  if (risk === 'medium') {
    return 'warning';
  }
  return 'info';
}

/** Stable alert id for a drone-derived alert. */
export function droneAlertId(droneId: string, kind: string): string {
  return `alert-drone-${droneId}-${kind}`;
}

/** Stable alert id for a weather-derived alert. */
export function weatherAlertId(weatherId: string): string {
  return `alert-weather-${weatherId}`;
}

/**
 * Derives the current alert feed. Drone alerts are ordered by severity (most
 * severe first) then by callsign, and weather cells follow, so the feed is
 * stable for a given state and the operator always sees the worst item first.
 */
export function deriveAlerts(drones: Drone[], weatherAlerts: WeatherAlert[], nowIso: string): Alert[] {
  const droneAlerts: Alert[] = [];
  for (const drone of drones) {
    if (drone.status === 'critical') {
      droneAlerts.push({
        id: droneAlertId(drone.id, 'critical'),
        severity: 'critical',
        type: 'Aircraft critical',
        sourceDroneId: drone.id,
        sourceDrone: drone.callsign,
        message: `${drone.callsign} reports a critical flight condition at ${drone.altitudeM} m.`,
        atIso: drone.lastSeenIso,
        acknowledged: false,
      });
    } else if (drone.status === 'warning') {
      droneAlerts.push({
        id: droneAlertId(drone.id, 'watch'),
        severity: 'warning',
        type: 'Aircraft watch',
        sourceDroneId: drone.id,
        sourceDrone: drone.callsign,
        message: `${drone.callsign} is on watch at ${drone.altitudeM} m, ${drone.speedKph} kph.`,
        atIso: drone.lastSeenIso,
        acknowledged: false,
      });
    }

    if (drone.batteryPct <= LOW_BATTERY_PCT && drone.status !== 'grounded') {
      droneAlerts.push({
        id: droneAlertId(drone.id, 'battery'),
        severity: drone.batteryPct <= LOW_BATTERY_PCT - 15 ? 'critical' : 'warning',
        type: 'Battery low',
        sourceDroneId: drone.id,
        sourceDrone: drone.callsign,
        message: `${drone.callsign} battery at ${drone.batteryPct}% — plan a recovery.`,
        atIso: drone.lastSeenIso,
        acknowledged: false,
      });
    }

    if (drone.status === 'grounded') {
      droneAlerts.push({
        id: droneAlertId(drone.id, 'grounded'),
        severity: 'info',
        type: 'Aircraft grounded',
        sourceDroneId: drone.id,
        sourceDrone: drone.callsign,
        message: `${drone.callsign} is grounded and available for tasking.`,
        atIso: drone.lastSeenIso,
        acknowledged: false,
      });
    }
  }

  const severityRank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  droneAlerts.sort(
    (a: Alert, b: Alert): number =>
      severityRank[a.severity] - severityRank[b.severity] || a.sourceDrone.localeCompare(b.sourceDrone),
  );

  const weatherAlertsDerived: Alert[] = weatherAlerts.map(
    (weather: WeatherAlert): Alert => ({
      id: weatherAlertId(weather.id),
      severity: severityForRisk(weather.severity),
      type: 'Weather',
      sourceDroneId: '',
      sourceDrone: 'HKO weather feed',
      message: `${weather.type} over the operating area — wind ${weather.windKph} kph, rain ${weather.precipitationMmH} mm/h.`,
      atIso: nowIso,
      acknowledged: false,
    }),
  );

  return [...droneAlerts, ...weatherAlertsDerived];
}

/** Re-applies previously acknowledged ids onto a freshly derived feed. */
export function preserveAcknowledgements(next: Alert[], acknowledgedIds: ReadonlySet<string>): Alert[] {
  return next.map((alert: Alert): Alert => (acknowledgedIds.has(alert.id) ? { ...alert, acknowledged: true } : alert));
}

/** Count of unacknowledged alerts at or above `minSeverity`. */
export function pendingAlertCount(alerts: Alert[], minSeverity: AlertSeverity = 'info'): number {
  const rank: Record<AlertSeverity, number> = { critical: 2, warning: 1, info: 0 };
  return alerts.filter((alert: Alert): boolean => !alert.acknowledged && rank[alert.severity] >= rank[minSeverity]).length;
}
