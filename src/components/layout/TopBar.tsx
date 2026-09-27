import type { NavSection, UserRole } from '../../types/domain';
import { useDashboardStore } from '../../store/dashboardStore';
import { resolveBackend } from '../../services/dataBackends';

interface TopBarProps {
  activeRole: UserRole;
  activeSection: NavSection;
  emergencyMode: boolean;
  lastUpdatedIso: string;
  onRoleChange: (role: UserRole) => void;
  onEmergency: () => void;
}

const sectionTitleById: Record<NavSection, string> = {
  operations: 'Operator tactical dashboard',
  missions: 'Flight plans and mission queue',
  wallet: 'Operator credit wallet',
  esg: 'Operator ESG scorecard',
  fleet: 'Operator fleet status',
  analytics: 'Operator analytics',
  alerts: 'Operator alert feed',
  weather: 'Weather and 3D situational awareness',
  approvals: 'Administrative approvals queue',
  admin: 'Administrative compliance overview',
};

const operatorOptions: { id: string; name: string }[] = [
  { id: 'wallet-harbour', name: 'Harbour Ops Desk' },
  { id: 'wallet-urban', name: 'Urban Scan Team' },
  { id: 'wallet-cargo', name: 'Cargo Pilot Cell' },
];

export function TopBar({
  activeRole,
  activeSection,
  emergencyMode,
  lastUpdatedIso,
  onRoleChange,
  onEmergency,
}: TopBarProps): JSX.Element {
  const backendLabel = useDashboardStore((state) => resolveBackend(state.backendId).label);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);
  const setOperator = useDashboardStore((state) => state.setOperator);
  const threeDView = useDashboardStore((state) => state.threeDView);
  const openThreeDView = useDashboardStore((state) => state.openThreeDView);
  const drones = useDashboardStore((state) => state.drones);
  // PRD §11.3.3: the operator console scopes the map to this operator's fleet.
  const visibleFleet =
    activeRole === 'admin'
      ? drones.length
      : drones.filter((drone) => drone.operatorId === currentOperatorId).length;
  const updatedAt: string = new Intl.DateTimeFormat('en-HK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(lastUpdatedIso));

  return (
    <header className="top-bar">
      <div>
        <p className="panel__eyebrow">Milestone 2 · planning + data adapters</p>
        <h1>{sectionTitleById[activeSection]}</h1>
        <div className="top-bar__meta" aria-label="Operational status">
          <span>Region: Hong Kong schematic</span>
          <span>Data source: {backendLabel}</span>
          <span>
            {activeRole === 'admin' ? `Fleet scope: all operators (${visibleFleet})` : `Fleet scope: own drones (${visibleFleet})`}
          </span>
          <span>Updated: {updatedAt}</span>
        </div>
        {activeRole === 'operator' && (
          <div className="operator-switcher">
            <label className="label-text" htmlFor="operator-select">Operator</label>
            <select
              id="operator-select"
              value={currentOperatorId}
              onChange={(event) => setOperator(event.target.value)}
            >
              {operatorOptions.map((operator) => (
                <option key={operator.id} value={operator.id}>{operator.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="role-switcher" aria-label="Role and emergency controls">
        <button
          type="button"
          className="role-button"
          aria-pressed={activeRole === 'operator'}
          onClick={() => onRoleChange('operator')}
        >
          <span aria-hidden="true">OPS</span> Operator
        </button>
        <button
          type="button"
          className="role-button"
          aria-pressed={activeRole === 'admin'}
          onClick={() => onRoleChange('admin')}
        >
          <span aria-hidden="true">ADM</span> Admin
        </button>
        {/* PRD S126: the 3D View is reachable from BOTH role dashboards, so this lives in
            the shared top bar rather than in either role's sidebar set (S111/S120 pin those
            counts exactly). */}
        <button
          type="button"
          className="control-button"
          aria-pressed={threeDView}
          onClick={openThreeDView}
          title="Full-screen 3D city model (PRD §11.4)"
        >
          <span aria-hidden="true">3D</span> 3D View
        </button>
        <button
          type="button"
          className="control-button"
          aria-pressed={emergencyMode}
          onClick={onEmergency}
          style={{ borderColor: emergencyMode ? 'var(--color-red)' : undefined }}
        >
          <span aria-hidden="true">EMG</span>
          {emergencyMode ? 'Emergency active' : 'Emergency hold'}
        </button>
      </div>
    </header>
  );
}
