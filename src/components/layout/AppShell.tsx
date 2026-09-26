import { useEffect } from 'react';
import { EmptyState } from '../common/EmptyState';
import { MetricCard } from '../common/MetricCard';
import { TacticalMap } from '../map/TacticalMap';
import { AdminPanel } from '../panels/AdminPanel';
import { MissionPanel } from '../panels/MissionPanel';
import { StatusPanel } from '../panels/StatusPanel';
import { useDashboardStore } from '../../store/dashboardStore';
import type { Drone } from '../../types/domain';
import { SidebarNav } from './SidebarNav';
import { TopBar } from './TopBar';

function useAutoInitialize(): void {
  const initialize = useDashboardStore((state) => state.initialize);

  useEffect((): void => {
    initialize();
  }, [initialize]);
}

export function AppShell(): JSX.Element {
  useAutoInitialize();

  const activeRole = useDashboardStore((state) => state.activeRole);
  const activeSection = useDashboardStore((state) => state.activeSection);
  const drones = useDashboardStore((state) => state.drones);
  const missions = useDashboardStore((state) => state.missions);
  const weatherAlerts = useDashboardStore((state) => state.weatherAlerts);
  const lastUpdatedIso = useDashboardStore((state) => state.lastUpdatedIso);
  const emergencyMode = useDashboardStore((state) => state.emergencyMode);
  const setRole = useDashboardStore((state) => state.setRole);
  const navigate = useDashboardStore((state) => state.navigate);
  const triggerEmergency = useDashboardStore((state) => state.triggerEmergency);
  const clearEmergency = useDashboardStore((state) => state.clearEmergency);

  const activeDrones: number = drones.filter((drone: Drone): boolean => drone.status !== 'grounded').length;
  const warningDrones: number = drones.filter(
    (drone: Drone): boolean => drone.status === 'warning' || drone.status === 'critical',
  ).length;
  const averageBattery: number = Math.round(
    drones.reduce((total: number, drone: Drone): number => total + drone.batteryPct, 0) / Math.max(drones.length, 1),
  );
  const emergencyAction = emergencyMode ? clearEmergency : triggerEmergency;

  return (
    <div className="app-shell">
      <SidebarNav activeRole={activeRole} activeSection={activeSection} onNavigate={navigate} />
      <div className="app-main">
        <TopBar
          activeRole={activeRole}
          activeSection={activeSection}
          emergencyMode={emergencyMode}
          lastUpdatedIso={lastUpdatedIso}
          onRoleChange={setRole}
          onEmergency={emergencyAction}
        />
        <main className="dashboard-layout" id="main-content">
          <section className="map-column" aria-label="Tactical dashboard">
            <div className="metric-grid" aria-label="Operational key performance indicators">
              <MetricCard label="Active drones" value={`${activeDrones}/${drones.length}`} trend="Fleet in controlled airspace" tone="good" icon="AIR" />
              <MetricCard label="Mission load" value={`${missions.length}`} trend="Mock routes visible on map" tone="neutral" icon="NAV" />
              <MetricCard label="Weather cells" value={`${weatherAlerts.length}`} trend="Layered aviation advisories" tone="warning" icon="WX" />
              <MetricCard label="Avg battery" value={`${averageBattery}%`} trend={`${warningDrones} aircraft need watch`} tone={warningDrones > 0 ? 'warning' : 'good'} icon="BAT" />
            </div>
            {activeSection === 'operations' && <TacticalMap />}
            {activeSection === 'missions' && <MissionPanel expanded />}
            {activeSection === 'admin' && activeRole === 'admin' && <AdminPanel expanded />}
            {activeSection === 'admin' && activeRole !== 'admin' && (
              <EmptyState
                title="Admin role required"
                message="Switch to Admin in the top bar to view compliance and system controls."
              />
            )}
          </section>
          <aside className="panel-stack" aria-label="Context panels">
            <StatusPanel />
            {activeSection !== 'missions' && <MissionPanel />}
            {activeRole === 'admin' && activeSection !== 'admin' && <AdminPanel />}
          </aside>
        </main>
      </div>
    </div>
  );
}
