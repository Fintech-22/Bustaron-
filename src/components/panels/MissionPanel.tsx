import { useState } from 'react';
import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { planDraftRoute, useDashboardStore } from '../../store/dashboardStore';
import type { Mission, MissionStatus, RiskLevel } from '../../types/domain';
import type { ZoneHit } from '../../services/geo/pointInPolygon';

// Demo endpoints verified clear of every CAD RFZ margin. NOTE (corrected
// 284-zone pack): the Victoria Harbour RFZ correctly seals mid-harbour
// transits, so the default draft pairs the Central pier with the western
// harbour entrance (Stonecutters west). Central <-> Kwun Tong / Lei Yue Mun
// refusals are compliance-correct and asserted in scripts/probe_lifecycle.ts.
const draftLocations: { name: string; point: { lat: number; lng: number } }[] = [
  { name: 'Central pier', point: { lat: 22.286, lng: 114.157 } },
  { name: 'Aberdeen south', point: { lat: 22.262, lng: 114.155 } },
  { name: 'Lei Yue Mun east', point: { lat: 22.29, lng: 114.247 } },
  { name: 'West Lamma channel', point: { lat: 22.262, lng: 114.1 } },
  { name: 'Stonecutters west', point: { lat: 22.32, lng: 114.12 } },
  { name: 'Kwun Tong promenade', point: { lat: 22.312, lng: 114.225 } },
];

function ZoneHitList({ hits }: { hits: ZoneHit[] }): JSX.Element {
  return (
    <ul aria-label="Restricted zones near origin">
      {hits.map((hit: ZoneHit) => (
        <li key={hit.zone.id} className="helper-text">
          {hit.zone.name} · {hit.distanceM === 0 ? 'inside zone' : `${hit.distanceM} m from boundary`} · {hit.zone.riskLevel} risk
        </li>
      ))}
    </ul>
  );
}

interface MissionPanelProps {
  expanded?: boolean;
}

const riskColorByName: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

const missionStatusLabelByName: Record<MissionStatus, string> = {
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

export function MissionPanel({ expanded = false }: MissionPanelProps): JSX.Element {
  const missions = useDashboardStore((state) => state.missions);
  const flightDraftOpen = useDashboardStore((state) => state.flightDraftOpen);
  const plannedRoute = useDashboardStore((state) => state.plannedRoute);
  const routeZoneHits = useDashboardStore((state) => state.routeZoneHits);
  const lastError = useDashboardStore((state) => state.lastError);
  const startFlightDraft = useDashboardStore((state) => state.startFlightDraft);
  const clearFlightDraft = useDashboardStore((state) => state.clearFlightDraft);
  const [originName, setOriginName] = useState(draftLocations[0].name);
  const [destinationName, setDestinationName] = useState(draftLocations[4].name);
  const origin = draftLocations.find((entry) => entry.name === originName) ?? draftLocations[0];
  const destination = draftLocations.find((entry) => entry.name === destinationName) ?? draftLocations[1];
  const sectionTitle = expanded ? 'Mission planning workspace' : 'Mission queue';

  return (
    <section className="panel" aria-labelledby="mission-panel-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Operator action state</p>
          <h2 className="panel__title" id="mission-panel-title">{sectionTitle}</h2>
        </div>
        <button type="button" className="control-button" onClick={flightDraftOpen ? clearFlightDraft : startFlightDraft}>
          <span aria-hidden="true">{flightDraftOpen ? 'X' : 'NEW'}</span>
          {flightDraftOpen ? 'Close draft' : 'New Flight'}
        </button>
      </div>

      {flightDraftOpen && (
        <div className="status-item spaced-bottom" role="status" aria-live="polite">
          <strong>New Flight draft is open.</strong>
          <p className="helper-text">A* planning runs against the active data source's zones; nothing is persisted.</p>
          <div className="route-controls spaced-top" role="group" aria-label="Route planner controls">
            <label className="label-text" htmlFor="route-origin">Origin</label>
            <select id="route-origin" value={originName} onChange={(event) => setOriginName(event.target.value)}>
              {draftLocations.map((entry) => (
                <option key={entry.name} value={entry.name}>{entry.name}</option>
              ))}
            </select>
            <label className="label-text" htmlFor="route-destination">Destination</label>
            <select id="route-destination" value={destinationName} onChange={(event) => setDestinationName(event.target.value)}>
              {draftLocations.map((entry) => (
                <option key={entry.name} value={entry.name}>{entry.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="control-button"
              disabled={originName === destinationName}
              onClick={() => planDraftRoute(origin.point, destination.point)}
            >
              Plan A* route
            </button>
          </div>
          {plannedRoute && (
            <p className="helper-text" role="status">
              Route planned: {plannedRoute.distanceM >= 1000
                ? `${(plannedRoute.distanceM / 1000).toFixed(1)} km`
                : `${plannedRoute.distanceM} m`}{' '}
              via {plannedRoute.waypoints.length} waypoints · {plannedRoute.nodesExpanded} nodes expanded.
            </p>
          )}
          {lastError && (
            <EmptyState
              compact
              headingLevel={3}
              variant="error"
              title="Route planning failed"
              message={lastError}
            />
          )}
          {routeZoneHits.length > 0 && <ZoneHitList hits={routeZoneHits} />}
        </div>
      )}

      {/* The "shared altitude ceiling" range slider that used to live here was
          removed: it wrote to `altitudeBandM`, which nothing read, so it filtered
          nothing while looking like a working control. The real altitude filter is
          the five PRD band buttons (AltitudeBandControls → `altitudeFilterM`). */}

      {missions.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No missions in the queue"
          message="Filed flight requests appear here once an operator submits them for the active data source."
        />
      ) : (
        <ul className="mission-list" aria-label="Mock missions">
          {missions.map((mission: Mission): JSX.Element => (
            <li key={mission.id} className="mission-item">
              <div className="mission-row">
                <strong>{mission.name}</strong>
                <span
                  className="badge"
                  style={{ '--badge-color': riskColorByName[mission.riskLevel], '--badge-border': riskColorByName[mission.riskLevel] } as CSSProperties}
                >
                  {mission.riskLevel} risk
                </span>
              </div>
              <p className="helper-text">
                {mission.operator} · {missionStatusLabelByName[mission.status]} · {mission.altitudeWindowM[0]}-{mission.altitudeWindowM[1]} m
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
