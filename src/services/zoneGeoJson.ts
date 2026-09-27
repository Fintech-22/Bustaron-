import type { AirspaceZone, Drone, GeoPoint, Mission, WeatherAlert } from '../types/domain';

/**
 * GeoJSON conversion for the Mapbox tactical overlay. Zones carry a per-feature
 * `kind`/`riskLevel` so the styling lives entirely in Mapbox layer paint
 * expressions (restricted = red, sandbox = amber, heliport = blue, corridor =
 * dashed cyan), matching PRD FR-OP-V3/S106.
 */
export function zonesToGeoJson(zones: AirspaceZone[]): unknown {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      id: zone.id,
      properties: {
        id: zone.id,
        name: zone.name,
        kind: zone.kind,
        riskLevel: zone.riskLevel,
        restriction: zone.restriction,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [zone.polygon.map((point: GeoPoint): [number, number] => [point.lng, point.lat])],
      },
    })),
  };
}

export function dronesToGeoJson(drones: Drone[], selectedDroneId: string): unknown {
  return {
    type: 'FeatureCollection',
    features: drones.map((drone) => ({
      type: 'Feature',
      id: drone.id,
      properties: {
        id: drone.id,
        callsign: drone.callsign,
        operatorId: drone.operatorId,
        altitudeM: drone.altitudeM,
        status: drone.status,
        headingDeg: drone.headingDeg,
        batteryPct: drone.batteryPct,
        speedKph: drone.speedKph,
        selected: drone.id === selectedDroneId,
      },
      geometry: { type: 'Point', coordinates: [drone.position.lng, drone.position.lat] },
    })),
  };
}

export function missionsToGeoJson(missions: Mission[]): unknown {
  return {
    type: 'FeatureCollection',
    features: missions.map((mission) => ({
      type: 'Feature',
      id: mission.id,
      properties: {
        id: mission.id,
        name: mission.name,
        riskLevel: mission.riskLevel,
        status: mission.status,
      },
      geometry: {
        type: 'LineString',
        coordinates: mission.route.map((point: GeoPoint): [number, number] => [point.lng, point.lat]),
      },
    })),
  };
}

export function weatherToGeoJson(alerts: WeatherAlert[]): unknown {
  return {
    type: 'FeatureCollection',
    features: alerts.map((alert) => ({
      type: 'Feature',
      id: alert.id,
      properties: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        windKph: alert.windKph,
        windDirectionDeg: alert.windDirectionDeg,
        precipitationMmH: alert.precipitationMmH,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [alert.area.map((point: GeoPoint): [number, number] => [point.lng, point.lat])],
      },
    })),
  };
}

/** Mean of a WGS84 ring — used to anchor weather wind arrows. */
function centroidOf(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) {
    return { lat: 0, lng: 0 };
  }
  const sum = points.reduce(
    (total: GeoPoint, point: GeoPoint): GeoPoint => ({ lat: total.lat + point.lat, lng: total.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * Point features for the Mapbox wind-arrow symbol layer (PRD FR-OP-V5 / S108):
 * one arrow per weather cell, rotated to the forecast bearing by the layer's
 * `icon-rotate` expression.
 */
export function weatherArrowsToGeoJson(alerts: WeatherAlert[]): unknown {
  return {
    type: 'FeatureCollection',
    features: alerts.map((alert) => {
      const center = centroidOf(alert.area);
      return {
        type: 'Feature',
        id: `${alert.id}-arrow`,
        properties: {
          id: `${alert.id}-arrow`,
          severity: alert.severity,
          windKph: alert.windKph,
          windDirectionDeg: alert.windDirectionDeg,
        },
        geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
      };
    }),
  };
}

export function plannedRouteToGeoJson(route: { waypoints: GeoPoint[] } | null): unknown {
  return {
    type: 'FeatureCollection',
    features:
      route && route.waypoints.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: route.waypoints.map((point: GeoPoint): [number, number] => [point.lng, point.lat]),
              },
            },
          ]
        : [],
  };
}
