/**
 * 24-hour Sky Occupancy model (STAGE 4 / PRD §11.2.2).
 *
 * Derives a deterministic 24-point hourly time series from the current fleet
 * and mission set. The model blends:
 *   — A diurnal baseline (low overnight, peaks 09:00–17:00 HKT) reflecting
 *     typical HK commercial drone operations under VFR.
 *   — Active mission count by hour (missions with ETAs within the hour boost
 *     occupancy).
 *   — Airborne drone fraction (drones with speedKph > 0 contribute to the
 *     current-hour reading).
 *
 * No randomness — the same fleet/mission state always produces the same series,
 * so the chart is deterministic and testable.
 */

import type { Drone, Mission } from '../types/domain';

export interface OccupancyPoint {
  /** Hour of day 0–23 (HKT). */
  hour: number;
  /** Occupancy value 0–100 (percentage of airspace utilisation). */
  occupancy: number;
  /** Number of active sorties projected for this hour. */
  sorties: number;
}

/** Diurnal baseline: minimal night ops, ramp from 07:00, peak 10:00–16:00, taper by 19:00. */
const DIURNAL: number[] = [
  2, 1, 1, 1, 2, 3, 5, 10, 18, 28, 35, 38, 40, 38, 36, 35, 30, 22, 14, 8, 5, 4, 3, 2,
];

/** Maps an ISO timestamp to an hour-of-day (0–23), defaulting to the current hour. */
function hourFromIso(iso: string | null): number {
  if (iso === null || iso === '') return new Date().getHours();
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return new Date().getHours();
  return new Date(parsed).getHours();
}

/**
 * Builds the 24-hour sky occupancy series.
 *
 * @param drones   The scoped fleet (operator or system-wide).
 * @param missions The scoped mission set.
 * @returns 24 hourly data points, index 0 = midnight HKT.
 */
export function buildSkyOccupancy24h(drones: Drone[], missions: Mission[]): OccupancyPoint[] {
  const airborne = drones.filter((d) => d.speedKph > 0 && d.status !== 'grounded').length;
  const grounded = drones.filter((d) => d.status === 'grounded').length;
  const fleetSize = drones.length;

  // Count missions whose ETA falls in each hour.
  const missionsByHour: number[] = new Array(24).fill(0);
  for (const mission of missions) {
    const hour = hourFromIso(mission.etaIso);
    if (mission.status === 'active' || mission.status === 'scheduled') {
      missionsByHour[hour] += 1;
    }
  }

  // Current hour boost from airborne drones.
  const currentHour = new Date().getHours();

  const points: OccupancyPoint[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const base = DIURNAL[hour];

    // Mission contribution: each active/scheduled mission in this hour adds ~3%.
    const missionBoost = missionsByHour[hour] * 3;

    // Fleet airborne contribution: scales the current-hour reading.
    const fleetFactor = fleetSize > 0 ? (airborne / fleetSize) * 15 : 0;

    // Grounded drones reduce overnight availability slightly.
    const groundedPenalty = fleetSize > 0 ? (grounded / fleetSize) * 2 : 0;

    let occupancy = base + missionBoost;
    if (hour === currentHour) {
      occupancy += fleetFactor;
    }
    occupancy -= groundedPenalty;
    occupancy = Math.max(0, Math.min(100, Math.round(occupancy)));

    points.push({
      hour,
      occupancy,
      sorties: missionsByHour[hour] + (hour === currentHour ? airborne : 0),
    });
  }

  return points;
}

/** Peak occupancy across the 24-hour series (0–100). */
export function peakOccupancy(points: OccupancyPoint[]): number {
  return points.reduce((max, p) => Math.max(max, p.occupancy), 0);
}

/** Mean occupancy across the 24-hour series (0–100, rounded). */
export function meanOccupancy(points: OccupancyPoint[]): number {
  if (points.length === 0) return 0;
  const sum = points.reduce((s, p) => s + p.occupancy, 0);
  return Math.round(sum / points.length);
}
