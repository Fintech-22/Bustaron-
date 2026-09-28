import { useDashboardStore } from '../../store/dashboardStore';
import type { AirspaceZone, Drone, GeoPoint, Mission, RiskLevel, WeatherAlert } from '../../types/domain';
import { DroneMarker } from './DroneMarker';
import { MapLayerControls } from './MapLayerControls';
import { AltitudeBandControls } from './AltitudeBandControls';
import { droneInBand } from '../../services/altitudeBands';
import { ringCentroid } from '../../services/mapProjection';

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
  low: '#16a34a',
  medium: '#d97706',
  high: '#ea580c',
  critical: '#dc2626',
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
  const altitudeFilterM = useDashboardStore((state) => state.altitudeFilterM);
  const activeRole = useDashboardStore((state) => state.activeRole);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);
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
          <p className="helper-text" id="tactical-map-description">Schematic 2D view. Zones from the active data source; dashed cyan line shows the planned A* route.</p>        </div>
        <button type="button" className="control-button" onClick={tick}>
          <span aria-hidden="true">TICK</span> Advance mock tick
        </button>
      </div>
      <MapLayerControls activeLayers={activeLayers} onToggleLayer={toggleLayer} />
      <AltitudeBandControls />
      {/*
        The container is a labelled group, not role="img": the SVG below carries the
        graphic semantics, while the drone buttons stay siblings so keyboard and
        screen-reader users can reach and select every aircraft.
      */}
      <div
        className="map-canvas"
        role="group"
        aria-label="Schematic Hong Kong tactical map with selectable drone markers"
        aria-describedby="tactical-map-description"
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label="Schematic Hong Kong geography: Kowloon, Victoria Harbour and Hong Kong Island, with restricted zones, weather cells and mission routes."
        >
          <defs>
            <pattern id="fine-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="0.16" />
            </pattern>
            {/*
              PRD FR-OP-V3 / S106: restricted zones are red outlines with DIAGONAL
              HATCHING. The hatch is a 45°-rotated user-space pattern so it reads
              as hazard marking rather than a solid fill.
            */}
            <pattern id="rfz-hatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2.4" height="2.4" fill="rgba(251,113,133,0.14)" />
              <line x1="0" y1="0" x2="0" y2="2.4" stroke="var(--color-red)" strokeWidth="0.5" />
            </pattern>
            {/* PRD FR-OP-V5 / S108: precipitation shading for weather cells. */}
            <pattern id="precip-hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2="1.6" stroke="var(--color-blue)" strokeWidth="0.35" />
            </pattern>
            <linearGradient id="water-gradient" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#b8d4e8" />
              <stop offset="100%" stopColor="#a0c4e0" />
            </linearGradient>
          </defs>
          <rect width="100" height="100" fill="#f0f4f8" />
          {activeLayers.grid && <rect width="100" height="100" fill="url(#fine-grid)" />}
          <path d="M0,54 C17,47 28,55 43,50 C58,45 68,43 82,49 C90,52 95,50 100,46 L100,100 L0,100 Z" fill="url(#water-gradient)" opacity="0.78" />
          <path d="M0,0 L100,0 L100,44 C91,48 84,45 76,42 C60,36 45,39 31,43 C18,47 9,42 0,46 Z" fill="#e8e0d0" />
          <path d="M0,62 C17,55 30,62 44,58 C61,54 75,56 100,51 L100,100 L0,100 Z" fill="#d4e8d0" opacity="0.92" />
          <text x="9" y="33" fill="rgba(0,0,0,0.35)" fontSize="3.3">KOWLOON</text>
          <text x="42" y="73" fill="rgba(0,0,0,0.35)" fontSize="3.3">HONG KONG ISLAND</text>
          <text x="38" y="55" fill="rgba(0,0,0,0.3)" fontSize="2.7">VICTORIA HARBOUR</text>
          {/*
            PRD FR-OP-V3 / S106: restricted (RFZ) zones render as red outlines with
            diagonal hatching; sandbox zones render as amber outlines. Other zone
            classes keep their risk-tinted fill.
          */}
          {activeLayers.restrictedZones && zones.map((zone: AirspaceZone): JSX.Element => {
            const restricted: boolean = zone.kind === 'rfz';
            const sandbox: boolean = zone.kind === 'sandbox';
            const sensitive: boolean = zone.kind === 'sensitive';
            const stroke: string = restricted ? 'var(--color-red)' : sandbox ? 'var(--color-amber)' : sensitive ? '#c084fc' : riskColorByName[zone.riskLevel];
            const fill: string = restricted ? 'url(#rfz-hatch)' : sandbox ? 'var(--color-amber)' : riskColorByName[zone.riskLevel];
            const fillOpacity: number = restricted ? 1 : sandbox ? 0.12 : zone.kind === 'corridor' ? 0.08 : 0.16;
            return (
              <polygon
                key={zone.id}
                data-zone-id={zone.id}
                data-zone-kind={zone.kind}
                points={pointsToSvg(zone.polygon)}
                fill={fill}
                fillOpacity={fillOpacity}
                stroke={stroke}
                strokeWidth={restricted ? 0.7 : sensitive ? 0.6 : 0.45}
                strokeDasharray={zone.kind === 'corridor' ? '1.4 1.2' : '0'}
              />
            );
          })}
          {/*
            PRD FR-OP-V5 / S108: weather overlay — precipitation zones plus a wind
            direction arrow rotated to the forecast bearing, labelled with the
            wind speed.
          */}
          {activeLayers.weather && weatherAlerts.map((alert: WeatherAlert): JSX.Element => {
            const color: string = riskColorByName[alert.severity];
            const centroid = projectPoint(ringCentroid(alert.area));
            return (
              <g key={alert.id} data-weather-id={alert.id}>
                <polygon
                  data-weather-zone={alert.id}
                  points={pointsToSvg(alert.area)}
                  fill={alert.precipitationMmH > 0 ? 'url(#precip-hatch)' : 'none'}
                  fillOpacity="0.5"
                  stroke={color}
                  strokeWidth="0.35"
                  strokeDasharray="1 0.8"
                />
                <g
                  data-weather-arrow="wind"
                  data-wind-kph={alert.windKph}
                  transform={`translate(${centroid.x.toFixed(2)} ${centroid.y.toFixed(2)}) rotate(${alert.windDirectionDeg})`}
                >
                  <path d="M -3.2 0 L 3.2 0 M 1.4 -1.6 L 3.2 0 L 1.4 1.6" stroke={color} strokeWidth="0.5" fill="none" strokeLinecap="round" />
                </g>
                <text x={centroid.x + 3.6} y={centroid.y - 2.2} fill={color} fontSize="2.4">
                  {alert.windKph} kph
                </text>
              </g>
            );
          })}
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
        {activeLayers.drones && drones
          // PRD §11.3.3: operators see own drones only; admin sees the system.
          .filter((drone: Drone): boolean => activeRole === 'admin' || drone.operatorId === currentOperatorId)
          .filter((drone: Drone): boolean => droneInBand(drone, altitudeFilterM))
          .map((drone: Drone): JSX.Element => {
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
