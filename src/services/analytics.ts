import type { Drone, GeoPoint, Mission } from '../types/domain';
import { buildSkycells } from './skycells';
import type { Skycell } from './skycells';
import { analyseRouteRisk, routeLengthM } from './missionService';
import { quoteRouteCredits } from './creditsService';
import { evaluateZonesAtPoint } from './geo/pointInPolygon';
import type { AirspaceZone } from '../types/domain';

/**
 * Analytics tab model (PRD §11.2.2): a personal traffic heatmap, flight
 * efficiency metrics and a cost analysis. Everything is derived from the
 * operator's own fleet and route set so the figures are "personal" rather than
 * system-wide, and are deterministic for a given state.
 */

export interface EfficiencyMetrics {
  sorties: number;
  totalDistanceKm: number;
  averageSpeedKph: number;
  averageAltitudeM: number;
  /** Share of the scoped fleet that is airborne, 0–100. */
  utilisationPct: number;
  averageBatteryPct: number;
}

export interface CostAnalysis {
  /** Blended credit cost per kilometre across the route set. */
  creditsPerKm: number;
  totalRouteCredits: number;
  /** Extrapolated monthly spend assuming the current daily cadence. */
  projectedMonthlyCredits: number;
  highestCostMissionName: string | null;
  highestCostCredits: number;
}

export interface AnalyticsReport {
  /** Occupancy lattice for the operator's own traffic, row-major. */
  heatmap: Skycell[];
  /** The busiest cells, descending by occupancy — the heatmap's "hot spots". */
  hotSpots: Skycell[];
  maxOccupancy: number;
  efficiency: EfficiencyMetrics;
  cost: CostAnalysis;
}

function scopedMissionsForOperator(missions: Mission[], operatorName: string | null): Mission[] {
  if (operatorName === null) {
    return missions;
  }
  return missions.filter((mission: Mission): boolean => mission.operator === operatorName);
}

/**
 * Builds the analytics report.
 *
 * @param drones    the operator's own fleet (already role/operator scoped).
 * @param missions  the full mission list; `operatorName` narrows it further.
 * @param zones     the active zone pack, used for the per-route risk surcharge.
 * @param operatorName the operator display name, or null for the whole system.
 */
export function buildAnalyticsReport(
  drones: Drone[],
  missions: Mission[],
  zones: AirspaceZone[],
  operatorName: string | null,
): AnalyticsReport {
  const scopedMissions = scopedMissionsForOperator(missions, operatorName);
  const heatmap = buildSkycells(drones, scopedMissions);
  const hotSpots = heatmap
    .filter((cell: Skycell): boolean => cell.occupancy > 0)
    .sort((a: Skycell, b: Skycell): number => b.occupancy - a.occupancy)
    .slice(0, 6);
  const maxOccupancy = heatmap.reduce((max: number, cell: Skycell): number => Math.max(max, cell.occupancy), 0);

  const totalDistanceM = scopedMissions.reduce((total: number, mission: Mission): number => total + routeLengthM(mission.route), 0);
  const moving = drones.filter((drone: Drone): boolean => drone.speedKph > 0);
  const averageSpeedKph =
    moving.length === 0 ? 0 : Math.round(moving.reduce((total: number, drone: Drone): number => total + drone.speedKph, 0) / moving.length);
  const airborne = drones.filter((drone: Drone): boolean => drone.speedKph > 0 && drone.status !== 'grounded');
  const averageAltitudeM =
    airborne.length === 0
      ? 0
      : Math.round(airborne.reduce((total: number, drone: Drone): number => total + drone.altitudeM, 0) / airborne.length);
  const averageBatteryPct =
    drones.length === 0
      ? 0
      : Math.round(drones.reduce((total: number, drone: Drone): number => total + drone.batteryPct, 0) / drones.length);

  let totalRouteCredits = 0;
  let highestCostMissionName: string | null = null;
  let highestCostCredits = 0;
  for (const mission of scopedMissions) {
    const analysis = analyseRouteRisk(mission.route, zones);
    const highRiskSegments = analysis.restrictedHits;
    const credits = quoteRouteCredits(routeLengthM(mission.route), highRiskSegments);
    totalRouteCredits += credits;
    if (credits > highestCostCredits) {
      highestCostCredits = credits;
      highestCostMissionName = mission.name;
    }
  }
  const totalDistanceKm = totalDistanceM / 1000;
  const creditsPerKm = totalDistanceKm === 0 ? 0 : Math.round((totalRouteCredits / totalDistanceKm) * 10) / 10;

  return {
    heatmap,
    hotSpots,
    maxOccupancy: Math.round(maxOccupancy * 100) / 100,
    efficiency: {
      sorties: scopedMissions.length,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      averageSpeedKph,
      averageAltitudeM,
      utilisationPct: drones.length === 0 ? 0 : Math.round((airborne.length / drones.length) * 100),
      averageBatteryPct,
    },
    cost: {
      creditsPerKm,
      totalRouteCredits,
      projectedMonthlyCredits: totalRouteCredits * 30,
      highestCostMissionName,
      highestCostCredits,
    },
  };
}

/** True when a route point lies inside any zone of the given kind. */
export function routeEntersZoneKind(route: GeoPoint[], zones: AirspaceZone[], kind: AirspaceZone['kind']): boolean {
  return route.some(
    (point: GeoPoint): boolean =>
      evaluateZonesAtPoint(point, zones).some((hit): boolean => hit.zone.kind === kind),
  );
}
