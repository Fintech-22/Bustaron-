import { useDashboardStore } from '../../store/dashboardStore';
import type { AirspaceZone, Drone, GeoPoint, Mission, RiskLevel, WeatherAlert } from '../../types/domain';
import { DroneMarker } from './DroneMarker';
import { MapLayerControls } from './MapLayerControls';

interface ProjectedPoint {
  x: number;
  y: number;
}

const mapBounds = {
  minLat: 22.255,
  maxLat: 22.37,
  minLng: 114.095,
  maxLng: 114.25,
};

const riskColorByName: Record<RiskLevel, string> = {
  low: '#4ade80',
  medium: '#fbbf24',
  high: '#fb7185',
  critical: '#ef4444',
};

function projectPoint(point: GeoPoint): ProjectedPoint {
  const x = ((point.lng - mapBounds.minLng) / (mapBounds.maxLng - mapBounds.minLng)) * 100;
  const y = (1 - (point.lat - mapBounds.minLat) / (mapBounds.maxLat - mapBounds.minLat)) * 100;
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(94, Math.max(6, y)) };
}

function pointsToSvg(points: GeoPoint[]): string {
  return points.map((point: GeoPoint): string => {
    const projected = projectPoint(point);
    return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
  }).join(' ');
}

export function TacticalMap(): JSX.Element {
  const drones = useDashboardStore((state) => state.drones);
  const missions = useDashboardStore((state) => state.missions);
  const weatherAlerts = useDashboardStore((state) => state.weatherAlerts);
  const zones = useDashboardStore((state) => state.zones);
  const activeLayers = useDashboardStore((state) => state.activeLayers);
  const selectedDroneId = useDashboardStore((state) => state.selectedDroneId);
  const plannedRoute = useDashboardStore((state) => state.plannedRoute);
  const selectDrone = useDashboardStore((state) => state.selectDrone);
  const toggleLayer = useDashboardStore((state) => state.toggleLayer);
  const tick = useDashboardStore((state) => state.tick);

  return (
    <section className="map-frame" aria-labelledby="tactical-map-title">
      <div className="map-header">
        <div>
          <p className="panel__eyebrow">2D Hong Kong tactical map</p>
          <h2 id="tactical-map-title">Victoria Harbour operating picture</h2>
          <p className="helper-text">Schematic 2D view. Zones from the active data source; dashed cyan line shows the planned A* route.</p>
        </div>
        <button type="button" className="control-button" onClick={tick}>
          <span aria-hidden="true">TICK</span> Advance mock tick
        </button>
      </div>
      <MapLayerControls activeLayers={activeLayers} onToggleLayer={toggleLayer} />
      <div className="map-canvas" role="img" aria-label="Schematic Hong Kong tactical map with selectable drone markers">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="fine-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth="0.16" />
            </pattern>
            <linearGradient id="water-gradient" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#0b3555" />
              <stop offset="100%" stopColor="#082236" />
            </linearGradient>
          </defs>
          <rect width="100" height="100" fill="#07101a" />
          {activeLayers.grid && <rect width="100" height="100" fill="url(#fine-grid)" />}
          <path d="M0,54 C17,47 28,55 43,50 C58,45 68,43 82,49 C90,52 95,50 100,46 L100,100 L0,100 Z" fill="url(#water-gradient)" opacity="0.78" />
          <path d="M0,0 L100,0 L100,44 C91,48 84,45 76,42 C60,36 45,39 31,43 C18,47 9,42 0,46 Z" fill="#0f1f2e" />
          <path d="M0,62 C17,55 30,62 44,58 C61,54 75,56 100,51 L100,100 L0,100 Z" fill="#0b1725" opacity="0.92" />
          <text x="9" y="33" fill="rgba(229,237,247,0.55)" fontSize="3.3">KOWLOON</text>
          <text x="42" y="73" fill="rgba(229,237,247,0.55)" fontSize="3.3">HONG KONG ISLAND</text>
          <text x="38" y="55" fill="rgba(229,237,247,0.42)" fontSize="2.7">VICTORIA HARBOUR</text>
          {activeLayers.restrictedZones && zones.map((zone: AirspaceZone): JSX.Element => (
            <polygon
              key={zone.id}
              points={pointsToSvg(zone.polygon)}
              fill={riskColorByName[zone.riskLevel]}
              fillOpacity={zone.kind === 'corridor' ? 0.08 : 0.16}
              stroke={riskColorByName[zone.riskLevel]}
              strokeWidth="0.45"
              strokeDasharray={zone.kind === 'corridor' ? '1.4 1.2' : '0'}
            />
          ))}
          {activeLayers.weather && weatherAlerts.map((alert: WeatherAlert): JSX.Element => (
            <g key={alert.id}>
              <polygon points={pointsToSvg(alert.area)} fill={riskColorByName[alert.severity]} fillOpacity="0.12" stroke={riskColorByName[alert.severity]} strokeWidth="0.35" />
              <path d="M14 20 l8 3 l-8 3 M21 23 H9" transform={`translate(${projectPoint(alert.area[0]).x - 8} ${projectPoint(alert.area[0]).y - 8})`} stroke={riskColorByName[alert.severity]} strokeWidth="0.9" fill="none" />
            </g>
          ))}
          {activeLayers.routes && missions.map((mission: Mission): JSX.Element => (
            <polyline
              key={mission.id}
              points={pointsToSvg(mission.route)}
              fill="none"
              stroke={riskColorByName[mission.riskLevel]}
              strokeWidth="0.75"
              strokeDasharray={mission.status === 'paused' ? '1.5 1' : '0'}
            />
          ))}
          {plannedRoute && activeLayers.routes && (
            <polyline
              points={pointsToSvg(plannedRoute.waypoints)}
              fill="none"
              stroke="var(--color-cyan)"
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeDasharray="2 1.2"
            />
          )}
        </svg>
        {activeLayers.drones && drones.map((drone: Drone): JSX.Element => {
          const point: ProjectedPoint = projectPoint(drone.position);
          return (
            <DroneMarker
              key={drone.id}
              drone={drone}
              xPct={point.x}
              yPct={point.y}
              selected={selectedDroneId === drone.id}
              onSelect={selectDrone}
            />
          );
        })}
      </div>
    </section>
  );
}
