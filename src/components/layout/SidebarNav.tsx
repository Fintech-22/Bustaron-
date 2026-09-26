import { useState } from 'react';
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
    description: 'Planning, A* routes and requests',
    role: 'both',
    icon: 'MIS',
  },
  {
    section: 'wallet',
    label: 'Credit wallet',
    description: 'Credits and slot auctions',
    role: 'both',
    icon: 'CRD',
  },
  {
    section: 'approvals',
    label: 'Approvals queue',
    description: 'Escrowed flight requests',
    role: 'admin',
    icon: 'APR',
  },
  {
    section: 'admin',
    label: 'Admin control',
    description: 'Compliance and system checks',
    role: 'admin',
    icon: 'ADM',
  },
];

/**
 * Primary navigation. On the smallest tier the section list collapses behind a
 * disclosure toggle so the tactical map (the PRD's primary landing element)
 * is not pushed several screens below the fold (TRACE T7 finding 3). From the
 * 768px tier up the list is permanently visible and the toggle is hidden.
 */
export function SidebarNav({ activeRole, activeSection, onNavigate }: SidebarNavProps): JSX.Element {
  const [navOpen, setNavOpen] = useState(false);
  const visibleItems: NavItem[] = navItems.filter(
    (item: NavItem): boolean => item.role === 'both' || item.role === activeRole,
  );

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar__topline">
        <div className="sidebar__brand">
          <div className="brand-mark" aria-hidden="true">B</div>
          <div>
            <p className="sidebar__title">BUSTARON</p>
            <span className="sidebar__subtitle">HK drone operations shell</span>
          </div>
        </div>
        <button
          type="button"
          className="control-button sidebar__toggle"
          aria-expanded={navOpen}
          aria-controls="sidebar-nav-sections"
          onClick={(): void => setNavOpen((open: boolean): boolean => !open)}
        >
          <span aria-hidden="true">{navOpen ? '×' : '≡'}</span>
          {navOpen ? 'Hide menu' : 'Menu'}
        </button>
      </div>
      <nav
        id="sidebar-nav-sections"
        className={navOpen ? 'nav-group' : 'nav-group nav-group--collapsed'}
        aria-label="Dashboard sections"
      >
        <p className="nav-group__label">Sections</p>
        {visibleItems.map((item: NavItem): JSX.Element => (
          <button
            key={item.section}
            type="button"
            className="nav-button"
            aria-current={activeSection === item.section ? 'page' : undefined}
            onClick={(): void => {
              onNavigate(item.section);
              setNavOpen(false);
            }}
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
