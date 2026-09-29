/**
 * Hong Kong Airspace Risk Score — dial gauge (STAGE 4 / PRD §11.2.2).
 *
 * Computes a numeric risk score 0–100 from the current fleet, weather alerts,
 * and zone risk levels, then renders it as a responsive SVG dial gauge.
 *
 * Risk factors (weighted):
 *   — Wind speed from weather alerts (40%)
 *   — Warning/critical drone count (25%)
 *   — High/critical zone count (20%)
 *   — Closed skycells (15%)
 */

import type { Drone, WeatherAlert, AirspaceZone } from '../types/domain';

export interface RiskScoreInput {
  drones: Drone[];
  weatherAlerts: WeatherAlert[];
  zones: AirspaceZone[];
  closedCellCount: number;
}

export interface RiskScoreResult {
  score: number;
  label: 'Low' | 'Moderate' | 'Elevated' | 'High';
  color: string;
  factors: { wind: number; drones: number; zones: number; closures: number };
}

const WIND_NORM_KPH = 80;
const MAX_ZONES = 10;
const MAX_CLOSURES = 20;

/**
 * Computes the HK Airspace Risk Score (0–100) from live operational data.
 */
export function computeRiskScore(input: RiskScoreInput): RiskScoreResult {
  const { drones, weatherAlerts, zones, closedCellCount } = input;

  // Wind factor: max wind across all weather alerts, normalized 0–100.
  const maxWind = weatherAlerts.length > 0
    ? Math.max(...weatherAlerts.map((a) => a.windKph))
    : 0;
  const windFactor = Math.min(100, Math.round((maxWind / WIND_NORM_KPH) * 100));

  // Drone factor: warning/critical drones as a fraction of fleet.
  const warningCount = drones.filter(
    (d) => d.status === 'warning' || d.status === 'critical',
  ).length;
  const droneFactor = drones.length > 0
    ? Math.round((warningCount / drones.length) * 100)
    : 0;

  // Zone factor: high/critical risk zones as a fraction of a nominal max.
  const riskZones = zones.filter((z) => z.riskLevel === 'high' || z.riskLevel === 'critical').length;
  const zoneFactor = Math.min(100, Math.round((riskZones / MAX_ZONES) * 100));

  // Closure factor: closed cells as a fraction of a nominal max.
  const closureFactor = Math.min(100, Math.round((closedCellCount / MAX_CLOSURES) * 100));

  const score = Math.round(
    windFactor * 0.40 + droneFactor * 0.25 + zoneFactor * 0.20 + closureFactor * 0.15,
  );

  let label: RiskScoreResult['label'] = 'Low';
  let color = '#4ade80';
  if (score >= 75) {
    label = 'High';
    color = '#ef4444';
  } else if (score >= 50) {
    label = 'Elevated';
    color = '#fb923c';
  } else if (score >= 25) {
    label = 'Moderate';
    color = '#facc15';
  }

  return {
    score,
    label,
    color,
    factors: { wind: windFactor, drones: droneFactor, zones: zoneFactor, closures: closureFactor },
  };
}
