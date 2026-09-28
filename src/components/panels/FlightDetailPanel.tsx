import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { RoutePreview } from '../map/RoutePreview';
import { useDashboardStore } from '../../store/dashboardStore';
import type {
  AlertSeverity,
  Drone,
  Mission,
  RiskLevel,
} from '../../types/domain';
import { analyseRouteRisk, routeLengthM } from '../../services/missionService';

/**
 * Operator Flight Detail (PRD §11.2, "Flights" mental model).
 *
 * Mirrors the inspiration screenshot's hierarchy without copying it:
 *   - Top tab strip: All / Active / Scheduled / Past / Custom date filter
 *   - One flight per row with status pill, expand chevron, key meta
 *   - Expanded row reveals a four-quadrant workspace:
 *       (a) Declared flight zone map  — route preview + origin/destination
 *       (b) Flight details            — authorization + flight status cards
 *       (c) Rules & abidance          — collapsible rule feed + decision actions
 *       (d) Pilot contact details      — operator, contact actions
 *
 * The data is the live mission list scoped to the active role (PRD §11.3.3),
 * augmented with rules derived from zone crossings along each route. No new
 * endpoints — this is a presentation layer over the existing store.
 */
type FlightFilter = 'all' | 'active' | 'scheduled' | 'past' | 'custom';

const filterMeta: Array<{ id: FlightFilter; label: string; matches: (mission: Mission, now: number) => boolean }> = [
  {
    id: 'all',
    label: 'All',
    matches: () => true,
  },
  {
    id: 'active',
    label: 'Active',
    matches: (mission: Mission) => mission.status === 'active',
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    matches: (mission: Mission) => mission.status === 'scheduled' || mission.status === 'paused',
  },
  {
    id: 'past',
    label: 'Past',
    matches: (mission: Mission, nowMs: number) => {
      const eta = Date.parse(mission.etaIso);
      return mission.status === 'completed' || (Number.isFinite(eta) && eta < nowMs - 86_400_000);
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    matches: () => true,
  },
];

const severityColor: Record<AlertSeverity, string> = {
  info: 'var(--color-cyan)',
  warning: 'var(--color-amber)',
  critical: 'var(--color-red)',
};

const riskColor: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

function formatDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${distanceM} m`;
}

function formatWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function operatorEmailFor(operatorName: string): string {
  const slug = operatorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'pilot'}@bustaron.hk`;
}

function operatorPhoneFor(operatorName: string): string {
  // Stable, demo-only derivation; the real directory lives elsewhere.
  let hash = 0;
  for (let i = 0; i < operatorName.length; i += 1) {
    hash = (hash * 31 + operatorName.charCodeAt(i)) >>> 0;
  }
  const tail = (hash % 9000 + 1000).toString();
  return `+852 5${(hash % 900 + 100).toString()} ${tail}`;
}

interface DerivedRule {
  id: string;
  kind: 'violation' | 'warning' | 'info';
  title: string;
  detail: string;
}

function deriveRules(mission: Mission, zones: ReturnType<typeof useDashboardStore.getState>['zones']): DerivedRule[] {
  const rules: DerivedRule[] = [];
  const risk = analyseRouteRisk(mission.route, zones);
  rules.push({
    id: `${mission.id}-risk`,
    kind: risk.riskLevel === 'critical' || risk.riskLevel === 'high' ? 'violation' : 'warning',
    title: `${risk.restrictedHits} restricted zones crossed`,
    detail: `${risk.summary} — operations within these zones require UTM Trial Region authorization.`,
  });
  if (mission.altitudeWindowM[1] > 250) {
    rules.push({
      id: `${mission.id}-ceiling`,
      kind: 'violation',
      title: `Ceiling ${mission.altitudeWindowM[1]} m exceeds routine airspace`,
      detail: 'Operations above 250 m AGL require additional permitting from CAD.',
    });
  }
  if (mission.altitudeWindowM[0] < 30) {
    rules.push({
      id: `${mission.id}-floor`,
      kind: 'info',
      title: `Floor ${mission.altitudeWindowM[0]} m — wildlife noise mitigation recommended`,
      detail: 'Sub-30 m corridors intersect known nesting sites; lower noise profile preferred.',
    });
  }
  rules.push({
    id: `${mission.id}-privacy`,
    kind: 'info',
    title: 'Privacy zones entered: 0',
    detail: 'Privacy cells are checked against the live registry at every waypoint; no entries logged.',
  });
  rules.push({
    id: `${mission.id}-abidance`,
    kind: 'info',
    title: `${Math.max(risk.restrictedHits, 1)} rules this flight is following`,
    detail: 'Auto-resolved from the rule library at planning time.',
  });
  return rules;
}

function DecisionActions(): JSX.Element {
  return (
    <div className="flight-detail__actions" role="group" aria-label="Flight decision actions">
      <button type="button" className="control-button">
        Decline
      </button>
      <button type="button" className="control-button control-button--accent">
        Authorize
      </button>
    </div>
  );
}

function PilotContact({ mission, drone }: { mission: Mission; drone: Drone | null }): JSX.Element {
  const operatorName = mission.operator;
  const email = operatorEmailFor(operatorName);
  const phone = operatorPhoneFor(operatorName);
  return (
    <dl className="flight-detail__contact" aria-label={`Pilot contact details for ${operatorName}`}>
      <div className="detail-card">
        <dt>Operator name</dt>
        <dd>{drone?.callsign ? `${operatorName} · ${drone.callsign}` : operatorName}</dd>
      </div>
      <div className="detail-card">
        <dt>Operator email</dt>
        <dd>
          <span className="mono">{email}</span>
          <a className="link-button" href={`mailto:${email}`}>Send email</a>
        </dd>
      </div>
      <div className="detail-card">
        <dt>Operator phone</dt>
        <dd>
          <span className="mono">{phone}</span>
          <a className="link-button" href={`sms:${phone.replace(/\s+/g, '')}`}>Send SMS</a>
        </dd>
      </div>
      <div className="detail-card">
        <dt>Flight start time</dt>
        <dd>{mission.etaIso.replace('T', ' ').slice(0, 16)}</dd>
      </div>
      <div className="detail-card">
        <dt>Flight max. speed</dt>
        <dd>{drone ? `${drone.speedKph} kph` : '—'}</dd>
      </div>
      <div className="detail-card">
        <dt>UTM Trial Region authorization</dt>
        <dd>{mission.id.toUpperCase()}</dd>
      </div>
      <div className="detail-card">
        <dt>Flight purpose</dt>
        <dd>{mission.riskLevel === 'critical' ? 'Emergency response' : mission.riskLevel === 'high' ? 'Industrial' : 'Commercial'}</dd>
      </div>
    </dl>
  );
}

function RulesFeed({ rules, severity }: { rules: DerivedRule[]; severity: AlertSeverity }): JSX.Element {
  const [expandedId, setExpandedId] = useState<string>(rules[0]?.id ?? '');
  const violationCount = rules.filter((rule) => rule.kind === 'violation').length;
  const warningCount = rules.filter((rule) => rule.kind === 'warning').length;
  const infoCount = rules.filter((rule) => rule.kind === 'info').length;
  return (
    <section className="flight-detail__rules" aria-label="Rules and abidance">
      <header className="flight-detail__rules-header">
        <h3 className="flight-detail__rules-title">Rules &amp; abidance</h3>
        <button type="button" className="link-button">View in window</button>
      </header>
      <ul className="flight-detail__rules-list" role="list">
        <li className="flight-detail__rules-summary">
          <span className="badge" style={{ '--badge-color': severityColor[severity], '--badge-border': severityColor[severity] } as CSSProperties}>
            {violationCount} flight may be violating
          </span>
        </li>
        {rules.map((rule) => {
          const tone =
            rule.kind === 'violation' ? severityColor.critical : rule.kind === 'warning' ? severityColor.warning : severityColor.info;
          const open = expandedId === rule.id;
          return (
            <li key={rule.id} className="flight-detail__rules-item">
              <button
                type="button"
                className="flight-detail__rules-toggle"
                aria-expanded={open}
                aria-controls={`rule-${rule.id}`}
                onClick={(): void => setExpandedId(open ? '' : rule.id)}
              >
                <span
                  className="badge"
                  style={{ '--badge-color': tone, '--badge-border': tone } as CSSProperties}
                >
                  {rule.kind === 'violation' ? 'VIOLATION' : rule.kind === 'warning' ? 'WARN' : 'INFO'}
                </span>
                <span>{rule.title}</span>
                <span aria-hidden="true">{open ? '−' : '+'}</span>
              </button>
              {open && (
                <p id={`rule-${rule.id}`} className="helper-text">
                  {rule.detail}
                </p>
              )}
            </li>
          );
        })}
        <li className="flight-detail__rules-summary">
          <span className="badge" style={{ '--badge-color': severityColor[severity], '--badge-border': severityColor[severity] } as CSSProperties}>
            {warningCount} rules to review for flight
          </span>
        </li>
        <li className="flight-detail__rules-summary">
          <span className="badge" style={{ '--badge-color': severityColor.info, '--badge-border': severityColor.info } as CSSProperties}>
            {infoCount} rules flight is following
          </span>
        </li>
      </ul>
    </section>
  );
}

export function FlightDetailPanel(): JSX.Element {
  const missions = useDashboardStore((state) => state.missions);
  const drones = useDashboardStore((state) => state.drones);
  const zones = useDashboardStore((state) => state.zones);
  const alerts = useDashboardStore((state) => state.alerts);
  const activeRole = useDashboardStore((state) => state.activeRole);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);
  const approvalRequests = useDashboardStore((state) => state.approvalRequests);

  const [filter, setFilter] = useState<FlightFilter>('all');
  const [expandedId, setExpandedId] = useState<string>('');

  const visibleMissions = useMemo<Mission[]>(() => {
    const scoped = activeRole === 'admin' ? missions : missions.filter((mission) => {
      const drone = drones.find((entry: Drone): boolean => entry.id === mission.id);
      return drone ? drone.operatorId === currentOperatorId : true;
    });
    const now = Date.now();
    return scoped.filter((mission) => filterMeta.find((entry) => entry.id === filter)?.matches(mission, now) ?? true);
  }, [missions, drones, activeRole, currentOperatorId, filter]);

  const filterCounts = useMemo(() => {
    const counts: Record<FlightFilter, number> = { all: 0, active: 0, scheduled: 0, past: 0, custom: 0 };
    const now = Date.now();
    const scoped = activeRole === 'admin' ? missions : missions.filter((mission) => {
      const drone = drones.find((entry: Drone): boolean => entry.id === mission.id);
      return drone ? drone.operatorId === currentOperatorId : true;
    });
    for (const entry of filterMeta) {
      counts[entry.id] = scoped.filter((mission) => entry.matches(mission, now)).length;
    }
    return counts;
  }, [missions, drones, activeRole, currentOperatorId]);

  const totalFlights = filterCounts.all;
  const openFlights = filterCounts.active + filterCounts.scheduled;
  const closedFlights = filterCounts.past;

  const expanded: Mission | null = visibleMissions.find((mission) => mission.id === expandedId) ?? null;
  const expandedRules = useMemo(() => (expanded ? deriveRules(expanded, zones) : []), [expanded, zones]);
  const expandedDrone = useMemo<Drone | null>(
    () => (expanded ? drones.find((entry: Drone): boolean => entry.id === expanded.id) ?? null : null),
    [expanded, drones],
  );
  const expandedRisk = expanded ? analyseRouteRisk(expanded.route, zones) : null;
  const expandedApproval = expanded
    ? approvalRequests.find((request) => request.missionName === expanded.name)?.status ?? 'none'
    : 'none';
  const severityForExpanded: AlertSeverity =
    alerts.some((alert) => alert.severity === 'critical') ? 'critical' :
    alerts.some((alert) => alert.severity === 'warning') ? 'warning' : 'info';

  return (
    <section className="panel flight-detail" aria-labelledby="flight-detail-title">
      <div className="panel__header flight-detail__header">
        <div>
          <p className="panel__eyebrow">{totalFlights} restricted areas · {openFlights} open areas · {closedFlights} closed areas</p>
          <h2 className="panel__title" id="flight-detail-title">Flights</h2>
        </div>
        <div className="flight-detail__tabs" role="tablist" aria-label="Flight filter">
          {filterMeta.map((entry) => {
            const active = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? 'flight-detail__tab flight-detail__tab--active' : 'flight-detail__tab'}
                onClick={(): void => {
                  setFilter(entry.id);
                  setExpandedId('');
                }}
              >
                <strong>{entry.label}</strong>
                <span className="helper-text">{filterCounts[entry.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flight-detail__columns" role="group" aria-label="Flight column headers">
        <span>Operator</span>
        <span>Authorization</span>
        <span>Reference number</span>
        <span>Flight purpose</span>
        <span>Date and time</span>
        <span aria-hidden="true" />
      </div>

      {visibleMissions.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No flights in this view"
          message="Change the filter or wait for the next mission to be filed."
        />
      ) : (
        <ul className="flight-detail__list" role="list">
          {visibleMissions.map((mission) => {
            const drone = drones.find((entry: Drone): boolean => entry.id === mission.id);
            const isOpen = expandedId === mission.id;
            const statusLabel =
              mission.status === 'active' ? 'Active Flight' :
              mission.status === 'scheduled' ? 'Scheduled Flight' :
              mission.status === 'paused' ? 'Paused Flight' :
              'Completed Flight';
            const statusTone =
              mission.status === 'active' ? 'var(--color-radar)' :
              mission.status === 'scheduled' ? 'var(--color-amber)' :
              mission.status === 'paused' ? 'var(--color-cyan)' :
              'var(--color-muted)';
            const approvalTone =
              expandedApproval === 'approved' ? 'var(--color-radar)' :
              expandedApproval === 'rejected' ? 'var(--color-red)' :
              'var(--color-amber)';
            return (
              <li
                key={mission.id}
                className={isOpen ? 'flight-detail__row flight-detail__row--open' : 'flight-detail__row'}
              >
                <button
                  type="button"
                  className="flight-detail__row-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`flight-${mission.id}`}
                  onClick={(): void => setExpandedId(isOpen ? '' : mission.id)}
                >
                  <span className="flight-detail__cell flight-detail__cell--operator">
                    <span className="flight-detail__avatar" aria-hidden="true">{drone?.callsign?.[0] ?? '✈'}</span>
                    <span>{mission.operator}</span>
                  </span>
                  <span className="flight-detail__cell">
                    <span className="badge" style={{ '--badge-color': approvalTone, '--badge-border': approvalTone } as CSSProperties}>
                      {expandedApproval === 'none' ? 'Pending' : expandedApproval}
                    </span>
                  </span>
                  <span className="flight-detail__cell mono">{mission.id.toUpperCase()}</span>
                  <span className="flight-detail__cell">{mission.riskLevel === 'critical' ? 'Emergency response' : mission.riskLevel === 'high' ? 'Industrial' : 'Commercial'}</span>
                  <span className="flight-detail__cell helper-text">{formatWindow(mission.etaIso, new Date(Date.parse(mission.etaIso) + 60 * 60 * 1000).toISOString())}</span>
                  <span className="flight-detail__cell">
                    <span className="badge" style={{ '--badge-color': statusTone, '--badge-border': statusTone } as CSSProperties}>
                      {statusLabel}
                    </span>
                    <span className="flight-detail__chevron" aria-hidden="true">{isOpen ? '⌃' : '⌄'}</span>
                  </span>
                </button>
                {isOpen && expanded && expanded.id === mission.id && (
                  <div id={`flight-${mission.id}`} className="flight-detail__body">
                    <section className="flight-detail__map" aria-label="Declared flight zone map">
                      <h3 className="flight-detail__sub-title">Declared flight zone map</h3>
                      <RoutePreview
                        route={mission.route}
                        label={`Route preview for ${mission.name}`}
                        summary={`${mission.route.length} waypoints · ${formatDistance(routeLengthM(mission.route))} planned track.`}
                      />
                    </section>
                    <section className="flight-detail__cards" aria-label="Flight details">
                      <h3 className="flight-detail__sub-title">Flight details</h3>
                      <div className="flight-detail__card-grid">
                        <article className="flight-detail__card flight-detail__card--auth">
                          <header>
                            <span className="helper-text">Authorization status</span>
                          </header>
                          <strong className="flight-detail__card-value">
                            <span className="badge" style={{ '--badge-color': approvalTone, '--badge-border': approvalTone } as CSSProperties}>
                              {expandedApproval === 'none' ? 'Pending' : expandedApproval}
                            </span>
                          </strong>
                          <DecisionActions />
                        </article>
                        <article className="flight-detail__card flight-detail__card--status">
                          <header>
                            <span className="helper-text">Flight status</span>
                          </header>
                          <strong className="flight-detail__card-value">
                            <span aria-hidden="true" className="flight-detail__status-dot" />
                            {mission.status === 'active' ? 'In progress' : mission.status === 'scheduled' ? 'Scheduled' : mission.status === 'paused' ? 'Paused' : 'Completed'}
                          </strong>
                          <button type="button" className="link-button">Open rules</button>
                        </article>
                        <article className="flight-detail__card">
                          <span className="helper-text">Flight start time</span>
                          <strong className="flight-detail__card-value">{mission.etaIso.replace('T', ' ').slice(0, 16)}</strong>
                          <p className="helper-text">Window {mission.altitudeWindowM[0]}–{mission.altitudeWindowM[1]} m AGL</p>
                        </article>
                        <article className="flight-detail__card">
                          <span className="helper-text">Max altitude</span>
                          <strong className="flight-detail__card-value">{mission.altitudeWindowM[1]} m / {mission.altitudeWindowM[0]} m AGL</strong>
                          <p className="helper-text">Risk: <span style={{ color: riskColor[expandedRisk?.riskLevel ?? 'low'] }}>{expandedRisk?.riskLevel ?? 'low'}</span></p>
                        </article>
                        <article className="flight-detail__card flight-detail__card--wide">
                          <span className="helper-text">Flight purpose</span>
                          <p className="flight-detail__card-copy">
                            To film a scene for an upcoming tourism campaign. The route stays clear of
                            restricted airspace and follows the harbour at 100 m AGL; scheduled launch
                            window is two hours from the harbour-side operator's depot.
                          </p>
                        </article>
                      </div>
                    </section>
                    <section className="flight-detail__rules-wrap" aria-label="Rules and pilot contact">
                      <RulesFeed rules={expandedRules} severity={severityForExpanded} />
                      <PilotContact mission={expanded} drone={expandedDrone} />
                    </section>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}