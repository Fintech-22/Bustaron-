import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import type { ComplianceWidget, RiskLevel, SystemWidget } from '../../types/domain';

interface AdminPanelProps {
  expanded?: boolean;
}

const riskColorByName: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

export function AdminPanel({ expanded = false }: AdminPanelProps): JSX.Element {
  const complianceWidgets = useDashboardStore((state) => state.complianceWidgets);
  const systemWidgets = useDashboardStore((state) => state.systemWidgets);
  const emergencyMode = useDashboardStore((state) => state.emergencyMode);
  const clearEmergency = useDashboardStore((state) => state.clearEmergency);

  return (
    <section className="panel" aria-labelledby="admin-panel-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Admin mock controls</p>
          <h2 className="panel__title" id="admin-panel-title">{expanded ? 'Compliance and system widgets' : 'Admin panel'}</h2>
        </div>
        {emergencyMode && (
          <button type="button" className="control-button" onClick={clearEmergency}>
            Clear emergency state
          </button>
        )}
      </div>

      {complianceWidgets.length === 0 && systemWidgets.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No compliance signals"
          message="Compliance and system widgets appear here once the active data source reports them."
        />
      ) : (
        <>
          <div className="admin-grid" aria-label="Compliance status widgets">
            {complianceWidgets.map((widget: ComplianceWidget): JSX.Element => (
              <article key={widget.id} className="admin-item">
                <div className="admin-row">
                  <span aria-hidden="true">SAFE</span>
                  <span
                    className="badge"
                    style={{ '--badge-color': riskColorByName[widget.status], '--badge-border': riskColorByName[widget.status] } as CSSProperties}
                  >
                    {widget.status}
                  </span>
                </div>
                <h3 className="panel__title">{widget.title}</h3>
                <strong>{widget.value}</strong>
                <p className="helper-text">{widget.detail}</p>
              </article>
            ))}
          </div>

          <ul className="admin-list spaced-top--lg" aria-label="System widgets">
            {systemWidgets.map((widget: SystemWidget): JSX.Element => (
              <li key={widget.id} className="admin-item">
                <div className="admin-row">
                  <span><span aria-hidden="true">SYS</span> {widget.title}</span>
                  <strong>{widget.value}</strong>
                </div>
                <p className="helper-text">{widget.detail}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
