import type { CSSProperties } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import type { Mission, MissionStatus, RiskLevel } from '../../types/domain';

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
  const altitudeBandM = useDashboardStore((state) => state.altitudeBandM);
  const startFlightDraft = useDashboardStore((state) => state.startFlightDraft);
  const clearFlightDraft = useDashboardStore((state) => state.clearFlightDraft);
  const setAltitudeBand = useDashboardStore((state) => state.setAltitudeBand);
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
        <div className="status-item" role="status" aria-live="polite" style={{ marginBottom: '0.85rem' }}>
          <strong>New Flight draft is open.</strong>
          <p className="helper-text">This is a non-persistent M1 UI state. Backend planning, A*, approvals, and auctions are not active.</p>
        </div>
      )}

      <div className="altitude-control" style={{ marginBottom: '0.9rem' }}>
        <label className="label-text" htmlFor="altitude-upper">Shared altitude ceiling: {altitudeBandM[1]} m</label>
        <input
          id="altitude-upper"
          type="range"
          min="80"
          max="220"
          step="10"
          value={altitudeBandM[1]}
          onChange={(event) => setAltitudeBand([altitudeBandM[0], Number(event.target.value)])}
        />
      </div>

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
    </section>
  );
}
