import type { NavSection, UserRole } from '../../types/domain';

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
  missions: 'Mission queue and altitude controls',
  admin: 'Administrative compliance overview',
};

export function TopBar({
  activeRole,
  activeSection,
  emergencyMode,
  lastUpdatedIso,
  onRoleChange,
  onEmergency,
}: TopBarProps): JSX.Element {
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
        <p className="panel__eyebrow">Milestone 1 · mock-only shell</p>
        <h1>{sectionTitleById[activeSection]}</h1>
        <div className="top-bar__meta" aria-label="Operational status">
          <span>Region: Hong Kong schematic</span>
          <span>Data: deterministic mock replay</span>
          <span>Updated: {updatedAt}</span>
        </div>
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
