import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import type { Alert, AlertSeverity } from '../../types/domain';

const severityColorByName: Record<AlertSeverity, string> = {
  info: 'var(--color-cyan)',
  warning: 'var(--color-amber)',
  critical: 'var(--color-red)',
};

const severityRank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function AlertRow({ alert }: { alert: Alert }): JSX.Element {
  const acknowledgeAlert = useDashboardStore((state) => state.acknowledgeAlert);
  return (
    <li className="alert-item" data-alert-id={alert.id} data-severity={alert.severity}>
      <div className="alert-row">
        <span
          className="badge"
          style={{ '--badge-color': severityColorByName[alert.severity], '--badge-border': severityColorByName[alert.severity] } as CSSProperties}
        >
          {alert.severity}
        </span>
        <strong>{alert.type}</strong>
        <span className="helper-text">{alert.sourceDrone}</span>
        <span className="helper-text mono">{formatTimestamp(alert.atIso)}</span>
      </div>
      <p className="helper-text">{alert.message}</p>
      <div className="alert-actions">
        <button
          type="button"
          className="control-button"
          aria-pressed={alert.acknowledged}
          aria-label={`Acknowledge ${alert.type} from ${alert.sourceDrone}`}
          disabled={alert.acknowledged}
          onClick={(): void => acknowledgeAlert(alert.id)}
        >
          {alert.acknowledged ? 'Acknowledged' : 'Acknowledge'}
        </button>
        <span className="helper-text" role="status">
          {alert.acknowledged ? 'Acknowledged' : 'Awaiting acknowledgement'}
        </span>
      </div>
    </li>
  );
}

/**
 * Alerts tab (PRD S115): a real-time feed with severity (info / warning /
 * critical), type, source drone, timestamp and an acknowledge button that
 * actually changes state. Alerts are derived from the live fleet and weather
 * state (see `deriveAlerts`), so the feed cannot drift from what it describes.
 */
export function AlertsPanel(): JSX.Element {
  const alerts = useDashboardStore((state) => state.alerts);
  const acknowledgeAllAlerts = useDashboardStore((state) => state.acknowledgeAllAlerts);

  const sorted: Alert[] = [...alerts].sort(
    (a: Alert, b: Alert): number => severityRank[a.severity] - severityRank[b.severity] || a.atIso.localeCompare(b.atIso),
  );
  const pending = alerts.filter((alert: Alert): boolean => !alert.acknowledged).length;
  const critical = alerts.filter((alert: Alert): boolean => alert.severity === 'critical' && !alert.acknowledged).length;

  return (
    <section className="panel" aria-labelledby="alerts-panel-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Live alert feed</p>
          <h2 className="panel__title" id="alerts-panel-title">Alerts</h2>
        </div>
        <div className="alert-header-actions">
          <span className="badge" style={{ '--badge-color': critical > 0 ? 'var(--color-red)' : 'var(--color-amber)' } as CSSProperties}>
            {pending} pending · {critical} critical
          </span>
          <button type="button" className="control-button" disabled={pending === 0} onClick={acknowledgeAllAlerts}>
            Acknowledge all
          </button>
        </div>
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No alerts"
          message="The feed is clear — no aircraft or weather conditions need attention."
        />
      ) : (
        <ul className="alert-list" aria-label="Alert feed">
          {sorted.map((alert: Alert): JSX.Element => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </ul>
      )}
    </section>
  );
}
