import { useState } from 'react';
import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { RoutePreview } from '../map/RoutePreview';
import { planDraftRoute, useDashboardStore } from '../../store/dashboardStore';
import type { Mission, MissionStatus, RiskLevel } from '../../types/domain';
import type { ZoneHit } from '../../services/geo/pointInPolygon';
import {
  FLIGHT_PLAN_LOCATIONS,
  MISSION_STATUSES,
  analyseRouteRisk,
  routeLengthM,
} from '../../services/missionService';

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

const approvalLabelByName: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  none: 'Not filed',
};

function formatDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${distanceM} m`;
}

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

/**
 * Flight Plans tab (PRD S112): full CRUD over flight plans — list, create,
 * view, update and delete — with a map preview of the route, a risk analysis
 * panel and the linked approval status.
 *
 * The create flow reuses the shared A* draft (`flightDraftOpen` / `plannedRoute`
 * / `planDraftRoute`) so planning behaves identically to the side mission panel
 * and nothing is persisted until "Save flight plan" is pressed.
 */
export function FlightPlansPanel(): JSX.Element {
  const missions = useDashboardStore((state) => state.missions);
  const zones = useDashboardStore((state) => state.zones);
  const approvalRequests = useDashboardStore((state) => state.approvalRequests);
  const wallets = useDashboardStore((state) => state.wallets);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);
  const flightDraftOpen = useDashboardStore((state) => state.flightDraftOpen);
  const plannedRoute = useDashboardStore((state) => state.plannedRoute);
  const routeZoneHits = useDashboardStore((state) => state.routeZoneHits);
  const lastError = useDashboardStore((state) => state.lastError);
  const startFlightDraft = useDashboardStore((state) => state.startFlightDraft);
  const clearFlightDraft = useDashboardStore((state) => state.clearFlightDraft);
  const addMission = useDashboardStore((state) => state.addMission);
  const updateMission = useDashboardStore((state) => state.updateMission);
  const deleteMission = useDashboardStore((state) => state.deleteMission);

  const [selectedId, setSelectedId] = useState<string>('');
  const [editingId, setEditingId] = useState<string>('');
  const [originName, setOriginName] = useState(FLIGHT_PLAN_LOCATIONS[0].name);
  const [destinationName, setDestinationName] = useState(FLIGHT_PLAN_LOCATIONS[4].name);
  const [draftName, setDraftName] = useState('');
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState<MissionStatus>('scheduled');

  const origin = FLIGHT_PLAN_LOCATIONS.find((entry) => entry.name === originName) ?? FLIGHT_PLAN_LOCATIONS[0];
  const destination = FLIGHT_PLAN_LOCATIONS.find((entry) => entry.name === destinationName) ?? FLIGHT_PLAN_LOCATIONS[1];
  const selected: Mission | null = missions.find((mission: Mission): boolean => mission.id === selectedId) ?? missions[0] ?? null;
  const operatorName = wallets.find((wallet) => wallet.id === currentOperatorId)?.operatorName ?? 'Unassigned operator';
  const draftRisk = plannedRoute ? analyseRouteRisk(plannedRoute.waypoints, zones) : null;

  const savePlan = (): void => {
    if (!plannedRoute) {
      return;
    }
    const risk = analyseRouteRisk(plannedRoute.waypoints, zones);
    const name = draftName.trim().length > 0 ? draftName.trim() : `Flight plan ${missions.length + 1}`;
    const id = addMission({
      name,
      operator: operatorName,
      route: plannedRoute.waypoints,
      status: 'scheduled',
      riskLevel: risk.riskLevel,
      altitudeWindowM: [80, 160],
      etaIso: new Date(Date.now()).toISOString(),
    });
    setSelectedId(id);
    setDraftName('');
    clearFlightDraft();
  };

  const beginEdit = (mission: Mission): void => {
    setEditingId(mission.id);
    setEditName(mission.name);
    setEditStatus(mission.status);
  };

  const commitEdit = (): void => {
    if (editingId === '') {
      return;
    }
    updateMission(editingId, {
      name: editName.trim().length > 0 ? editName.trim() : 'Untitled flight plan',
      status: editStatus,
    });
    setEditingId('');
  };

  const selectedRisk = selected ? analyseRouteRisk(selected.route, zones) : null;
  const selectedApproval = selected
    ? approvalRequests.find((request) => request.missionName === selected.name)?.status ?? 'none'
    : 'none';

  return (
    <section className="panel" aria-labelledby="flight-plans-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Flight plan lifecycle</p>
          <h2 className="panel__title" id="flight-plans-title">Flight Plans</h2>
        </div>
        <button type="button" className="control-button" onClick={flightDraftOpen ? clearFlightDraft : startFlightDraft}>
          <span aria-hidden="true">{flightDraftOpen ? 'X' : 'NEW'}</span>
          {flightDraftOpen ? 'Close draft' : 'New Flight'}
        </button>
      </div>

      {flightDraftOpen && (
        <div className="status-item spaced-bottom" role="status" aria-live="polite">
          <strong>New flight plan draft.</strong>
          <p className="helper-text">Plan the route with A*, review the risk, then save it as a flight plan.</p>
          <div className="route-controls spaced-top" role="group" aria-label="Route planner controls">
            <label className="label-text" htmlFor="plan-origin">Origin</label>
            <select id="plan-origin" value={originName} onChange={(event) => setOriginName(event.target.value)}>
              {FLIGHT_PLAN_LOCATIONS.map((entry) => (
                <option key={entry.name} value={entry.name}>{entry.name}</option>
              ))}
            </select>
            <label className="label-text" htmlFor="plan-destination">Destination</label>
            <select id="plan-destination" value={destinationName} onChange={(event) => setDestinationName(event.target.value)}>
              {FLIGHT_PLAN_LOCATIONS.map((entry) => (
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
              Route planned: {formatDistance(plannedRoute.distanceM)} via {plannedRoute.waypoints.length} waypoints ·{' '}
              {plannedRoute.nodesExpanded} nodes expanded.
            </p>
          )}
          {draftRisk && (
            <p className="helper-text">
              Draft risk: <strong>{draftRisk.riskLevel}</strong> · {draftRisk.summary}
            </p>
          )}
          {lastError && (
            <EmptyState compact headingLevel={3} variant="error" title="Route planning failed" message={lastError} />
          )}
          {routeZoneHits.length > 0 && <ZoneHitList hits={routeZoneHits} />}
          <div className="flight-plan-save spaced-top" role="group" aria-label="Save flight plan controls">
            <label className="label-text" htmlFor="flight-plan-name">Flight plan name</label>
            <input
              id="flight-plan-name"
              type="text"
              value={draftName}
              placeholder="e.g. Stonecutters resupply run"
              autoComplete="off"
              onChange={(event) => setDraftName(event.target.value)}
            />
            <button type="button" className="control-button" disabled={plannedRoute === null} onClick={savePlan}>
              Save flight plan
            </button>
          </div>
        </div>
      )}

      {missions.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No flight plans"
          message="Create a flight plan with New Flight; saved plans appear here with their risk analysis and approval status."
        />
      ) : (
        <ul className="mission-list" aria-label="Flight plans">
          {missions.map((mission: Mission): JSX.Element => (
            <li key={mission.id} className="mission-item">
              <div className="mission-row">
                <button
                  type="button"
                  className="link-button"
                  aria-pressed={selected?.id === mission.id}
                  onClick={() => setSelectedId(mission.id)}
                >
                  {mission.name}
                </button>
                <span
                  className="badge"
                  style={{ '--badge-color': riskColorByName[mission.riskLevel], '--badge-border': riskColorByName[mission.riskLevel] } as CSSProperties}
                >
                  {mission.riskLevel} risk
                </span>
              </div>
              <p className="helper-text">
                {mission.operator} · {missionStatusLabelByName[mission.status]} · {mission.altitudeWindowM[0]}-{mission.altitudeWindowM[1]} m ·{' '}
                {formatDistance(routeLengthM(mission.route))}
              </p>
              <div className="flight-plan-actions spaced-top" role="group" aria-label={`Flight plan actions for ${mission.name}`}>
                <button type="button" className="control-button" onClick={() => setSelectedId(mission.id)}>
                  View
                </button>
                <button type="button" className="control-button" onClick={() => beginEdit(mission)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="control-button"
                  aria-label={`Delete ${mission.name}`}
                  onClick={() => deleteMission(mission.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId !== '' && (
        <div className="status-item spaced-top" role="group" aria-label="Edit flight plan">
          <h3 className="panel__title">Update flight plan</h3>
          <label className="label-text" htmlFor="edit-plan-name">Edit name</label>
          <input
            id="edit-plan-name"
            type="text"
            value={editName}
            autoComplete="off"
            onChange={(event) => setEditName(event.target.value)}
          />
          <label className="label-text" htmlFor="edit-plan-status">Edit status</label>
          <select
            id="edit-plan-status"
            value={editStatus}
            onChange={(event) => setEditStatus(event.target.value as MissionStatus)}
          >
            {MISSION_STATUSES.map((status: MissionStatus) => (
              <option key={status} value={status}>{missionStatusLabelByName[status]}</option>
            ))}
          </select>
          <div className="flight-plan-actions spaced-top">
            <button type="button" className="control-button" onClick={commitEdit}>Save changes</button>
            <button type="button" className="control-button" onClick={() => setEditingId('')}>Cancel</button>
          </div>
        </div>
      )}

      {selected && (
        <div className="flight-plan-detail spaced-top--lg">
          <h3 className="panel__title">Plan detail · {selected.name}</h3>
          <RoutePreview
            route={selected.route}
            label={`Route preview for ${selected.name}`}
            summary={`${selected.route.length} waypoints · ${formatDistance(routeLengthM(selected.route))} planned track.`}
          />
          <dl className="drone-detail-grid spaced-top" aria-label="Risk analysis">
            <div className="detail-card">
              <dt>Risk level</dt>
              <dd style={{ color: riskColorByName[selectedRisk?.riskLevel ?? 'low'] }}>{selectedRisk?.riskLevel ?? 'low'}</dd>
            </div>
            <div className="detail-card">
              <dt>Restricted hits</dt>
              <dd>{selectedRisk?.restrictedHits ?? 0}</dd>
            </div>
            <div className="detail-card">
              <dt>Nearest restricted</dt>
              <dd>{selectedRisk?.nearestZoneName ?? 'None'}</dd>
            </div>
            <div className="detail-card">
              <dt>Approval status</dt>
              <dd>{approvalLabelByName[selectedApproval] ?? selectedApproval}</dd>
            </div>
          </dl>
          <p className="helper-text spaced-top">{selectedRisk?.summary}</p>
        </div>
      )}
    </section>
  );
}
