import cadRfzData from '../data/cadRfzData.json';
import { polygonBounds } from './geo/pointInPolygon';
import { SANDBOX_NAME_PATTERN } from './zoneClassification';
import type { AirspaceZone, GeoPoint, RiskLevel } from '../types/domain';

/**
 * Parsed shape of `src/data/cadRfzData.json` — a compacted subset of the CAD
 * RFZ pack (`C:\Users\user\Downloads\bustaron_map_data\GeoJSON\map.geojson`).
 * Rings are [lng, lat] pairs matching GeoJSON axis order; the raw file is
 * external data, so the wire types stay untyped and are narrowed below.
 */
interface CadRing {
  closed: boolean;
  coords: [number, number][];
}

interface CadFeature {
  id: string;
  name: string;
  type: string;
  designation: string;
  effective: string;
  ring: CadRing;
}

interface CadRoot {
  source: string;
  ingestedIso: string;
  features: CadFeature[];
}

const RISK_LEVEL_BY_TYPE: Record<string, RiskLevel> = {
  RFZ: 'high',
  Sandbox: 'medium',
};

/** Converts a GeoJSON-style [lng, lat] ring into the domain's GeoPolygon. */
function ringToPolygon(ring: [number, number][]): GeoPoint[] {
  return ring.map(([lng, lat]): GeoPoint => ({ lat, lng }));
}

let cachedZones: AirspaceZone[] | null = null;

/**
 * Loads every CAD-designated zone from the ingested GeoJSON-derived dataset.
 * Parsed once per process, then cached; always returns a fresh defensive copy.
 */
export function loadCadZones(): AirspaceZone[] {
  if (cachedZones) {
    return cachedZones.map((zone: AirspaceZone): AirspaceZone => ({ ...zone, polygon: [...zone.polygon] }));
  }

  const root: CadRoot = cadRfzData as unknown as CadRoot;
  cachedZones = root.features.map((feature: CadFeature): AirspaceZone => {
    // The CAD pack's `type` field is "RFZ" for both classes; the sandbox
    // designation lives in the zone NAME (PRD §5.3, defect 6).
    const sandbox = SANDBOX_NAME_PATTERN.test(feature.name);
    const riskLevel: RiskLevel = sandbox ? 'medium' : RISK_LEVEL_BY_TYPE[feature.type] ?? 'high';
    return {
      id: feature.id,
      name: feature.name,
      kind: sandbox ? 'sandbox' : 'rfz',
      polygon: ringToPolygon(feature.ring.coords),
      restriction: `${feature.designation} · ${feature.effective}`,
      riskLevel,
    };
  });

  return cachedZones.map((zone: AirspaceZone): AirspaceZone => ({ ...zone, polygon: [...zone.polygon] }));
}

/** Loads CAD zones that can possibly overlap the given viewport bounding box. */
export function loadCadZonesIntersecting(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): AirspaceZone[] {
  return loadCadZones().filter((zone: AirspaceZone): boolean => {
    const zoneBounds = polygonBounds(zone.polygon);
    return (
      zoneBounds.minLat <= bounds.maxLat &&
      zoneBounds.maxLat >= bounds.minLat &&
      zoneBounds.minLng <= bounds.maxLng &&
      zoneBounds.maxLng >= bounds.minLng
    );
  });
}
