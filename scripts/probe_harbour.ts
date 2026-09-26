/**
 * Diagnostic: why do Central <-> Kwun Tong / Lei Yue Mun routes fail?
 * Walks north-south transects across Victoria Harbour and prints which CAD
 * zones (with the planner's 60 m margin) block each crossing window.
 */
import { loadCadZones } from '../src/services/cadGeoJsonService';
import { evaluateZonesAtPoint } from '../src/services/geo/pointInPolygon';

const zones = loadCadZones();
const MARGIN = 60;

// East-west transects at several latitudes across the harbour.
const transects: { label: string; lng: number; latFrom: number; latTo: number }[] = [
  { label: 'Central (114.157)', lng: 114.157, latFrom: 22.33, latTo: 22.24 },
  { label: 'Wanchai (114.173)', lng: 114.173, latFrom: 22.33, latTo: 22.24 },
  { label: 'Causeway Bay (114.19)', lng: 114.19, latFrom: 22.33, latTo: 22.24 },
  { label: 'North Point (114.20)', lng: 114.20, latFrom: 22.33, latTo: 22.24 },
  { label: 'Kwun Tong line (114.225)', lng: 114.225, latFrom: 22.335, latTo: 22.29 },
  { label: 'Lei Yue Mun line (114.247)', lng: 114.247, latFrom: 22.335, latTo: 22.27 },
];

for (const transect of transects) {
  const rows: string[] = [];
  for (let lat = transect.latFrom; lat >= transect.latTo; lat -= 0.002) {
    const hits = evaluateZonesAtPoint({ lat, lng: transect.lng }, zones, MARGIN);
    if (hits.length > 0) {
      rows.push(`${lat.toFixed(3)}:${hits.map((hit) => hit.zone.name.slice(0, 28)).join('|')}`);
    }
  }
  console.log(`\n== ${transect.label} ==`);
  console.log(rows.length === 0 ? '  (clear)' : `  ${rows.join('\n  ')}`);
}

console.log('\n== origin/destination zone hits (120 m scan) ==');
const endpoints: Record<string, { lat: number; lng: number }> = {
  'Central pier': { lat: 22.286, lng: 114.157 },
  'Kwun Tong promenade': { lat: 22.312, lng: 114.225 },
  'Lei Yue Mun east': { lat: 22.29, lng: 114.247 },
};
for (const [name, point] of Object.entries(endpoints)) {
  const hits = evaluateZonesAtPoint(point, zones, 120);
  console.log(
    `${name}: ${hits.length === 0 ? 'clear' : hits.map((hit) => `${hit.zone.name.slice(0, 30)} @${Math.round(hit.distanceM)}m`).join(' | ')}`,
  );
}
