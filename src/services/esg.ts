import type { AirspaceZone, Drone, GeoPoint, Mission, RiskLevel } from '../types/domain';
import { analyseRouteRisk } from './missionService';

/**
 * ESG scorecard model (PRD §11.2.2 / S113-adjacent): carbon per km, noise by
 * zone, compliance rate, privacy violations, recycling score and the
 * fleet-weighted ESG multiplier. Every figure is derived from the current
 * operational state — no RNG, no wall clock — so the same state always renders
 * the same scorecard and a state change is visible immediately.
 */

/** Grams of CO2e per drone-kilometre for a nominal battery-electric sortie. */
const BASE_CARBON_G_PER_KM = 38;
/** Extra grams per km for each kph of cruise speed (drag grows with airspeed). */
const CARBON_G_PER_KPH = 0.35;
/** Reference intensity used to normalise the multiplier: a 80 g/km route scores zero. */
const CARBON_REFERENCE_G_PER_KM = 80;
/** A route within 70% of the reference intensity still earns an A. */
const CARBON_GRADE_A_G_PER_KM = CARBON_REFERENCE_G_PER_KM * 0.7;

/** Representative noise exposure per zone class, in dB(A) at 100 m. */
const NOISE_BY_KIND: Record<AirspaceZone['kind'], number> = {
  rfz: 0,
  sensitive: 48,
  sandbox: 62,
  heliport: 68,
  corridor: 55,
};

const ZONE_KIND_LABEL: Record<AirspaceZone['kind'], string> = {
  rfz: 'Restricted (RFZ)',
  sensitive: 'Sensitive site',
  sandbox: 'Regulatory sandbox',
  heliport: 'Heliport / corridor',
  corridor: 'Approved corridor',
};

export interface NoiseBand {
  zoneKind: AirspaceZone['kind'];
  label: string;
  zoneCount: number;
  /** Peak dB(A) at 100 m for this class; 0 means overflight is not permitted. */
  db: number;
  level: RiskLevel;
}

export interface EsgReport {
  /** Grams of CO2e per kilometre across the fleet's planned routes. */
  carbonPerKmG: number;
  /** Absolute carbon footprint of the current route set, in kg CO2e. */
  carbonKg: number;
  totalDistanceKm: number;
  noiseByZone: NoiseBand[];
  complianceRatePct: number;
  compliantMissions: number;
  totalMissions: number;
  privacyViolations: number;
  recyclingScorePct: number;
  esgMultiplier: number;
  grade: 'A' | 'B' | 'C' | 'D';
}

function missionDistanceM(mission: Mission): number {
  let total = 0;
  for (let i = 1; i < mission.route.length; i += 1) {
    const from: GeoPoint = mission.route[i - 1];
    const to: GeoPoint = mission.route[i];
    const dLat = (to.lat - from.lat) * 111_320;
    const dLng = (to.lng - from.lng) * 111_320 * Math.cos((22.31 * Math.PI) / 180);
    total += Math.hypot(dLat, dLng);
  }
  return total;
}

function noiseLevel(db: number): RiskLevel {
  if (db === 0) {
    return 'critical';
  }
  if (db >= 68) {
    return 'high';
  }
  if (db >= 60) {
    return 'medium';
  }
  return 'low';
}

function averageSpeedKph(drones: Drone[]): number {
  const moving = drones.filter((drone: Drone): boolean => drone.speedKph > 0);
  if (moving.length === 0) {
    return 0;
  }
  return moving.reduce((total: number, drone: Drone): number => total + drone.speedKph, 0) / moving.length;
}

/**
 * Builds the ESG report for the current fleet, route set and zone pack.
 *
 * `complianceRate` counts flight plans whose route is clear of restricted and
 * sensitive airspace; `privacyViolations` counts sampled route points that fall
 * INSIDE a sensitive zone (a deliberate overflight of a privacy-sensitive site).
 */
export function buildEsgReport(drones: Drone[], missions: Mission[], zones: AirspaceZone[]): EsgReport {
  const totalDistanceM = missions.reduce((total: number, mission: Mission): number => total + missionDistanceM(mission), 0);
  const totalDistanceKm = totalDistanceM / 1000;
  const carbonPerKmG = Math.round(BASE_CARBON_G_PER_KM + averageSpeedKph(drones) * CARBON_G_PER_KPH);
  const carbonKg = Math.round(((totalDistanceKm * carbonPerKmG) / 1000) * 10) / 10;

  let compliantMissions = 0;
  let privacyViolations = 0;
  for (const mission of missions) {
    const analysis = analyseRouteRisk(mission.route, zones);
    if (analysis.restrictedHits === 0) {
      compliantMissions += 1;
    }
    // A violation is a route point that lies strictly inside a sensitive zone.
    for (const point of mission.route) {
      const insideSensitive = zones.some(
        (zone: AirspaceZone): boolean =>
          zone.kind === 'sensitive' &&
          point.lat >= Math.min(...zone.polygon.map((p: GeoPoint): number => p.lat)) &&
          point.lat <= Math.max(...zone.polygon.map((p: GeoPoint): number => p.lat)) &&
          point.lng >= Math.min(...zone.polygon.map((p: GeoPoint): number => p.lng)) &&
          point.lng <= Math.max(...zone.polygon.map((p: GeoPoint): number => p.lng)),
      );
      if (insideSensitive) {
        privacyViolations += 1;
        break;
      }
    }
  }
  const totalMissions = missions.length;
  const complianceRatePct = totalMissions === 0 ? 100 : Math.round((compliantMissions / totalMissions) * 100);

  const presentKinds: AirspaceZone['kind'][] = (['rfz', 'sandbox', 'sensitive', 'heliport', 'corridor'] as AirspaceZone['kind'][]).filter(
    (kind: AirspaceZone['kind']): boolean => zones.some((zone: AirspaceZone): boolean => zone.kind === kind),
  );
  const noiseByZone: NoiseBand[] = presentKinds.map((kind: AirspaceZone['kind']): NoiseBand => {
    const db = NOISE_BY_KIND[kind];
    return {
      zoneKind: kind,
      label: ZONE_KIND_LABEL[kind],
      zoneCount: zones.filter((zone: AirspaceZone): boolean => zone.kind === kind).length,
      db,
      level: noiseLevel(db),
    };
  });

  const recyclingScorePct =
    drones.length === 0
      ? 100
      : Math.round(drones.reduce((total: number, drone: Drone): number => total + drone.batteryPct, 0) / drones.length);

  const complianceTerm = (complianceRatePct / 100) * 0.15;
  const carbonTerm = Math.max(0, 1 - carbonPerKmG / CARBON_REFERENCE_G_PER_KM) * 0.1;
  const violationPenalty = Math.min(0.15, privacyViolations * 0.05);
  const esgMultiplier = Math.round(Math.min(1.3, Math.max(1, 1 + complianceTerm + carbonTerm - violationPenalty)) * 100) / 100;

  let grade: EsgReport['grade'] = 'D';
  if (complianceRatePct >= 99 && privacyViolations === 0 && carbonPerKmG <= CARBON_GRADE_A_G_PER_KM) {
    grade = 'A';
  } else if (complianceRatePct >= 90 && privacyViolations <= 1) {
    grade = 'B';
  } else if (complianceRatePct >= 75) {
    grade = 'C';
  }

  return {
    carbonPerKmG,
    carbonKg,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    noiseByZone,
    complianceRatePct,
    compliantMissions,
    totalMissions,
    privacyViolations,
    recyclingScorePct,
    esgMultiplier,
    grade,
  };
}
