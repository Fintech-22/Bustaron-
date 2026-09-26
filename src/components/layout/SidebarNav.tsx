import type { NavSection, UserRole } from '../../types/domain';

interface NavItem {
  section: NavSection;
  label: string;
  description: string;
  role: UserRole | 'both';
  icon: string;
}

interface SidebarNavProps {
  activeRole: UserRole;
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
}

const navItems: NavItem[] = [
  {
    section: 'operations',
    label: 'Operations map',
    description: 'Live tactical overview',
    role: 'both',
    icon: 'OPS',
  },
  {
    section: 'missions',
    label: 'Mission queue',
    description: 'Mock requests and routes',
    role: 'both',
    icon: 'MIS',
  },
  {
    section: 'admin',
    label: 'Admin control',
    description: 'Compliance and system checks',
    role: 'admin',
    icon: 'ADM',
  },
];

export function SidebarNav({ activeRole, activeSection, onNavigate }: SidebarNavProps): JSX.Element {
  const visibleItems: NavItem[] = navItems.filter(
    (item: NavItem): boolean => item.role === 'both' || item.role === activeRole,
  );

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar__brand">
        <div className="brand-mark" aria-hidden="true">B</div>
        <div>
          <p className="sidebar__title">BUSTARON</p>
          <span className="sidebar__subtitle">HK drone operations shell</span>
        </div>
      </div>
      <nav className="nav-group" aria-label="Dashboard sections">
        <p className="nav-group__label">Sections</p>
        {visibleItems.map((item: NavItem): JSX.Element => (
          <button
            key={item.section}
            type="button"
            className="nav-button"
            aria-current={activeSection === item.section ? 'page' : undefined}
            onClick={() => onNavigate(item.section)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>
              <strong>{item.label}</strong>
              <br />
              <span className="helper-text">{item.description}</span>
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
