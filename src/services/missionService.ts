import type { AirspaceZone, GeoPoint, Mission, MissionStatus, RiskLevel } from '../types/domain';
import { evaluateZonesAtPoint, haversineM } from './geo/pointInPolygon';
import type { ZoneHit } from './geo/pointInPolygon';

/**
 * Flight-plan domain logic for the operator Flight Plans tab (PRD S112):
 * create / update / delete helpers plus a route risk analysis. All functions are
 * pure so the store stays a thin reducer and the behaviour is unit-testable.
 */

/** The editable subset of a flight plan. */
export type MissionDraft = Omit<Mission, 'id'>;

/** Named demo endpoints, reused by the mission panel and the flight-plan editor. */
export const FLIGHT_PLAN_LOCATIONS: { name: string; point: GeoPoint }[] = [
  { name: 'Central pier', point: { lat: 22.286, lng: 114.157 } },
  { name: 'Aberdeen south', point: { lat: 22.262, lng: 114.155 } },
  { name: 'Lei Yue Mun east', point: { lat: 22.29, lng: 114.247 } },
  { name: 'West Lamma channel', point: { lat: 22.262, lng: 114.1 } },
  { name: 'Stonecutters west', point: { lat: 22.32, lng: 114.12 } },
  { name: 'Kwun Tong promenade', point: { lat: 22.312, lng: 114.225 } },
];

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Higher of two risk levels. */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/** Great-circle length of a route in metres. */
export function routeLengthM(route: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += haversineM(route[i - 1], route[i]);
  }
  return Math.round(total);
}

/**
 * Deterministic id for a new flight plan. Derived from the existing ids so a
 * create always produces a unique, stable identifier without RNG.
 */
export function nextMissionId(existing: Mission[]): string {
  let highest = 0;
  for (const mission of existing) {
    const match = /^mission-(\d+)$/.exec(mission.id);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return `mission-${String(highest + 1).padStart(3, '0')}`;
}

/** Creates a flight plan from a draft, assigning a fresh unique id. */
export function createMission(draft: MissionDraft, existing: Mission[]): Mission {
  return { ...draft, id: nextMissionId(existing) };
}

/** Applies a partial update to one flight plan; other plans are returned untouched. */
export function updateMissionList(missions: Mission[], id: string, patch: Partial<MissionDraft>): Mission[] {
  return missions.map((mission: Mission): Mission => (mission.id === id ? { ...mission, ...patch, id: mission.id } : mission));
}

/** Removes one flight plan by id. */
export function deleteMissionFromList(missions: Mission[], id: string): Mission[] {
  return missions.filter((mission: Mission): boolean => mission.id !== id);
}

export interface RouteRiskAnalysis {
  riskLevel: RiskLevel;
  /** Distinct restricted/sensitive zones the route touches or passes within `marginM` of. */
  restrictedHits: number;
  /** Distinct sandbox zones along the route (permissible with authorization). */
  sandboxHits: number;
  /** Nearest restricted zone name, or null when the route is clear. */
  nearestZoneName: string | null;
  nearestDistanceM: number | null;
  /** Human summary for the risk panel. */
  summary: string;
}

/** Samples a route at its vertices and segment midpoints. */
function sampleRoute(route: GeoPoint[]): GeoPoint[] {
  if (route.length === 0) {
    return [];
  }
  const samples: GeoPoint[] = [...route];
  for (let i = 1; i < route.length; i += 1) {
    const from = route[i - 1];
    const to = route[i];
    samples.push({ lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 });
  }
  return samples;
}

/**
 * Risk analysis for a planned route (PRD S112 "risk analysis panel"): samples
 * the route against the active zone pack and folds the hits into a risk level.
 * Restricted and sensitive zones drive the level; sandbox transits are reported
 * separately because they are permissible with authorization (PRD §5.3).
 */
export function analyseRouteRisk(
  route: GeoPoint[],
  zones: AirspaceZone[],
  marginM = 120,
): RouteRiskAnalysis {
  const restricted = new Map<string, ZoneHit>();
  const sandbox = new Map<string, ZoneHit>();
  for (const point of sampleRoute(route)) {
    for (const hit of evaluateZonesAtPoint(point, zones, marginM)) {
      if (hit.zone.kind === 'sandbox') {
        if (!sandbox.has(hit.zone.id)) {
          sandbox.set(hit.zone.id, hit);
        }
      } else if (hit.zone.kind === 'rfz' || hit.zone.kind === 'sensitive') {
        const existing = restricted.get(hit.zone.id);
        if (!existing || hit.distanceM < existing.distanceM) {
          restricted.set(hit.zone.id, hit);
        }
      }
    }
  }

  const restrictedHits = restricted.size;
  const hits = [...restricted.values()].sort((a: ZoneHit, b: ZoneHit): number => a.distanceM - b.distanceM);
  const nearest = hits[0] ?? null;

  let riskLevel: RiskLevel = 'low';
  if (restrictedHits === 1) {
    riskLevel = 'medium';
  } else if (restrictedHits >= 2) {
    riskLevel = 'high';
  }
  for (const hit of hits) {
    if (hit.distanceM === 0 && hit.zone.riskLevel === 'critical') {
      riskLevel = 'critical';
    }
  }

  const summary =
    restrictedHits === 0
      ? `Clear of restricted airspace with a ${marginM} m margin.`
      : `Crosses or passes within ${marginM} m of ${restrictedHits} restricted zone${restrictedHits === 1 ? '' : 's'}${
          sandbox.size > 0 ? ` and ${sandbox.size} sandbox zone${sandbox.size === 1 ? '' : 's'}` : ''
        }.`;

  return {
    riskLevel,
    restrictedHits,
    sandboxHits: sandbox.size,
    nearestZoneName: nearest?.zone.name ?? null,
    nearestDistanceM: nearest?.distanceM ?? null,
    summary,
  };
}

/** Statuses offered by the flight-plan editor. */
export const MISSION_STATUSES: MissionStatus[] = ['scheduled', 'active', 'paused', 'completed'];
