import { describe, expect, it } from 'vitest';
import { evaluateZonesAtPoint, pointInPolygon, polygonBounds, haversineM } from '../services/geo/pointInPolygon';
import type { AirspaceZone } from '../types/domain';

function squareZone(lat: number, lng: number, sideDeg: number): AirspaceZone {
  const half = sideDeg / 2;
  return {
    id: 'zone-test',
    name: 'Test square',
    kind: 'rfz',
    polygon: [
      { lat: lat + half, lng: lng - half },
      { lat: lat + half, lng: lng + half },
      { lat: lat - half, lng: lng + half },
      { lat: lat - half, lng: lng - half },
    ],
    restriction: 'test',
    riskLevel: 'high',
  };
}

describe('pointInPolygon', () => {
  it('detects a point inside a square', () => {
    const zone = squareZone(22.3, 114.17, 0.02);
    expect(pointInPolygon({ lat: 22.3, lng: 114.17 }, zone.polygon)).toBe(true);
  });

  it('rejects a point outside a square', () => {
    const zone = squareZone(22.3, 114.17, 0.02);
    expect(pointInPolygon({ lat: 22.35, lng: 114.25 }, zone.polygon)).toBe(false);
  });

  it('handles concave polygons (L-shape notch)', () => {
    const lShape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 },
    ];
    expect(pointInPolygon({ lat: 1.5, lng: 1.5 }, lShape)).toBe(true);
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, lShape)).toBe(false);
  });

  it('is safe for degenerate polygons', () => {
    expect(pointInPolygon({ lat: 0, lng: 0 }, [])).toBe(false);
    expect(pointInPolygon({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBe(false);
  });
});

describe('evaluateZonesAtPoint', () => {
  const zone = squareZone(22.3, 114.17, 0.02);

  it('returns the zone with distance 0 when inside', () => {
    const hits = evaluateZonesAtPoint({ lat: 22.3, lng: 114.17 }, [zone]);
    expect(hits).toHaveLength(1);
    expect(hits[0].distanceM).toBe(0);
    expect(hits[0].zone.id).toBe('zone-test');
  });

  it('ignores zones outside the buffer when the point is outside', () => {
    expect(evaluateZonesAtPoint({ lat: 22.4, lng: 114.17 }, [zone], 100)).toHaveLength(0);
  });

  it('respects the buffer when the point is near the boundary', () => {
    // ~278 m south of the southern ring edge (0.0125 deg lat).
    const near = { lat: 22.3 - 0.0125, lng: 114.17 };
    expect(evaluateZonesAtPoint(near, [zone], 250)).toHaveLength(0);
    expect(evaluateZonesAtPoint(near, [zone], 300).length).toBe(1);
  });
});

describe('polygonBounds / haversineM', () => {
  it('computes the inclusive bounding box', () => {
    const bounds = polygonBounds([
      { lat: 22.1, lng: 114.1 },
      { lat: 22.5, lng: 114.4 },
    ]);
    expect(bounds).toEqual({ minLat: 22.1, maxLat: 22.5, minLng: 114.1, maxLng: 114.4 });
  });

  it('measures a known HK distance (Central to Kai Tak ~8.4 km)', () => {
    const central = { lat: 22.282, lng: 114.158 };
    const kaiTak = { lat: 22.305, lng: 114.201 };
    const d = haversineM(central, kaiTak);
    expect(d).toBeGreaterThan(4600);
    expect(d).toBeLessThan(5200);
  });
});
