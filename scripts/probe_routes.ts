import { planRoute } from '../src/services/routePlanner';
import { loadCadZones } from '../src/services/cadGeoJsonService';
import type { GeoPoint } from '../src/types/domain';

const candidates: Record<string, GeoPoint> = {
  'Central pier': { lat: 22.286, lng: 114.157 },
  'Aberdeen south': { lat: 22.262, lng: 114.155 },
  'Lei Yue Mun east': { lat: 22.29, lng: 114.247 },
  'West Lamma channel': { lat: 22.262, lng: 114.1 },
  'Stonecutters west': { lat: 22.32, lng: 114.12 },
  'Kwun Tong promenade': { lat: 22.312, lng: 114.225 },
  'Tsim Bei Tsui': { lat: 22.35, lng: 114.13 },
};

const zones = loadCadZones();
const names = Object.keys(candidates);

for (const from of names) {
  for (const to of names) {
    if (from === to) continue;
    try {
      const route = planRoute(candidates[from], candidates[to], { zones });
      console.log(`OK   ${from} -> ${to}: ${route.distanceM} m, ${route.waypoints.length} waypoints, ${route.nodesExpanded} nodes`);
    } catch (error) {
      console.log(`FAIL ${from} -> ${to}: ${(error as Error).message}`);
    }
  }
}
