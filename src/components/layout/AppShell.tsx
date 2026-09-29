import { useEffect, useState } from 'react';
import { EmptyState } from '../common/EmptyState';
import { MetricCard } from '../common/MetricCard';
import { MapHost } from '../map/MapHost';
import { ThreeDViewPanel } from '../three/ThreeDViewPanel';
import { WeatherPanel } from '../panels/WeatherPanel';
import { AdminPanel } from '../panels/AdminPanel';
import { AlertsPanel } from '../panels/AlertsPanel';
import { AnalyticsPanel } from '../panels/AnalyticsPanel';
import { ApprovalsQueuePanel } from '../panels/ApprovalsQueuePanel';
import { CreditWalletPanel } from '../panels/CreditWalletPanel';
import { EsgScorecardPanel } from '../panels/EsgScorecardPanel';
import { FleetPanel } from '../panels/FleetPanel';
import { FlightDetailPanel } from '../panels/FlightDetailPanel';
import { AirspaceManagementPanel } from '../panels/AirspaceManagementPanel';
import { FlightPlansPanel } from '../panels/FlightPlansPanel';
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

  // New (additive, no existing state touched): theme toggle between the
  // cyberpunk dark surface and the light fallback. Applied via [data-theme]
  // on the shell root so globals.css can repaint every descendant in one pass.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const toggleTheme = (): void => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  const activeRole = useDashboardStore((state) => state.activeRole);
  const activeSection = useDashboardStore((state) => state.activeSection);
  const drones = useDashboardStore((state) => state.drones);
  const wallets = useDashboardStore((state) => state.wallets);
  const approvalRequests = useDashboardStore((state) => state.approvalRequests);
  const alerts = useDashboardStore((state) => state.alerts);
  const lastUpdatedIso = useDashboardStore((state) => state.lastUpdatedIso);
  const emergencyMode = useDashboardStore((state) => state.emergencyMode);
  const threeDView = useDashboardStore((state) => state.threeDView);
  const threeDClosing = useDashboardStore((state) => state.threeDClosing);
  const finishCloseThreeDView = useDashboardStore((state) => state.finishCloseThreeDView);
  const setRole = useDashboardStore((state) => state.setRole);
  const navigate = useDashboardStore((state) => state.navigate);
  const triggerEmergency = useDashboardStore((state) => state.triggerEmergency);
  const clearEmergency = useDashboardStore((state) => state.clearEmergency);

  const activeDrones: number = drones.filter((drone: Drone): boolean => drone.status !== 'grounded').length;
  const warningDrones: number = drones.filter(
    (drone: Drone): boolean => drone.status === 'warning' || drone.status === 'critical',
  ).length;
  const emergencyAction = emergencyMode ? clearEmergency : triggerEmergency;

  // Mock-era ESG/risk rollups; M3 replaces them with computed ledger values.
  const esgScore = warningDrones === 0 ? 'A' : 'B';
  const cityRisk = warningDrones > 1 ? 'Elevated' : warningDrones === 1 ? 'Moderate' : 'Low';

  // PRD S110 (operator) / S117 (admin) live stats bars. The operator bar is
  // credits/ESG/alerts centric; the admin bar adds system-wide compliance and
  // ledger signals. Both keep the fleet metrics as trailing context.
  // Labels are Title Case to match PRD S110/S117 verbatim, so the bars can be
  // checked against the spec literally rather than "close enough".
  const totalCredits = wallets.reduce((total, wallet) => total + wallet.balanceCredits + wallet.reservedCredits, 0);
  const pendingApprovals = approvalRequests.filter((request) => request.status === 'pending').length;
  const pendingAlerts = alerts.filter((alert) => !alert.acknowledged).length;
  const operatorMetrics = [
    { label: 'Active Drones', value: `${activeDrones}/${drones.length}`, trend: 'Fleet in controlled airspace', tone: 'good' as const, icon: 'AIR' },
    { label: 'Credits Balance', value: `${totalCredits}`, trend: `${wallets.length} operator wallets`, tone: 'neutral' as const, icon: 'CRD' },
    { label: 'ESG Score', value: esgScore, trend: 'Fleet-weighted multiplier 1.15×', tone: 'good' as const, icon: 'ESG' },
    { label: 'Pending Alerts', value: `${pendingAlerts}`, trend: 'Weather + aircraft watch', tone: pendingAlerts > 0 ? 'warning' as const : 'good' as const, icon: 'ALR' },
  ];
  const adminMetrics = [
    { label: 'Active Drones', value: `${activeDrones}/${drones.length}`, trend: 'System-wide fleet', tone: 'good' as const, icon: 'AIR' },
    { label: 'Blockchain TPS', value: '0.0', trend: 'Chain live · TPS not yet wired', tone: 'neutral' as const, icon: 'BCH' },
    { label: 'City Risk Score', value: cityRisk, trend: `${warningDrones} aircraft on watch`, tone: warningDrones > 0 ? 'warning' as const : 'good' as const, icon: 'RSK' },
    { label: 'Pending Approvals', value: `${pendingApprovals}`, trend: 'Escrowed requests in queue', tone: pendingApprovals > 0 ? 'warning' as const : 'good' as const, icon: 'APR' },
  ];
  const visibleMetrics = activeRole === 'admin' ? adminMetrics : operatorMetrics;

  return (
    <div className="app-shell" data-theme={theme}>
      <SidebarNav activeRole={activeRole} activeSection={activeSection} onNavigate={navigate} />
      <div className="app-main">
        <TopBar
          activeRole={activeRole}
          activeSection={activeSection}
          emergencyMode={emergencyMode}
          lastUpdatedIso={lastUpdatedIso}
          onRoleChange={setRole}
          onEmergency={emergencyAction}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
        <main className="dashboard-layout" id="main-content">
          <section className="map-column" aria-label="Tactical dashboard">
            <div className="metric-grid" aria-label="Operational key performance indicators">
              {visibleMetrics.map((metric) => (
                <MetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  trend={metric.trend}
                  tone={metric.tone}
                  icon={metric.icon}
                />
              ))}
            </div>
            <div key={activeSection} className="section-transition">
              {activeSection === 'operations' && <MapHost />}
              {activeSection === 'missions' && <FlightPlansPanel />}
              {activeSection === 'wallet' && <CreditWalletPanel />}
              {activeSection === 'esg' && <EsgScorecardPanel />}
              {activeSection === 'fleet' && <FleetPanel />}
              {activeSection === 'analytics' && <AnalyticsPanel />}
              {activeSection === 'alerts' && <AlertsPanel />}
              {activeSection === 'weather' && <WeatherPanel />}
              {activeSection === 'flightDetail' && activeRole === 'operator' && <FlightDetailPanel />}
              {activeSection === 'flightDetail' && activeRole !== 'operator' && (
                <EmptyState
                  title="Operator role required"
                  message="Switch to Operator in the top bar to view the flight detail workspace."
                />
              )}
              {activeSection === 'airspace' && activeRole === 'admin' && <AirspaceManagementPanel />}
              {activeSection === 'airspace' && activeRole !== 'admin' && (
                <EmptyState
                  title="Admin role required"
                  message="Switch to Admin in the top bar to view the airspace management console."
                />
              )}
              {activeSection === 'approvals' && activeRole === 'admin' && <ApprovalsQueuePanel expanded />}
              {activeSection === 'admin' && activeRole === 'admin' && <AdminPanel expanded />}
              {(activeSection === 'admin' || activeSection === 'approvals' || activeSection === 'airspace') && activeRole !== 'admin' && (
                <EmptyState
                  title="Admin role required"
                  message="Switch to Admin in the top bar to view the approvals queue and compliance controls."
                />
              )}
            </div>
          </section>
          <aside className="panel-stack" aria-label="Context panels">
            <StatusPanel />
            {activeSection !== 'missions' && activeSection !== 'wallet' && <MissionPanel />}
            {activeRole === 'admin' && activeSection !== 'admin' && activeSection !== 'approvals' && <AdminPanel />}
          </aside>
        </main>
      </div>
      {/* PRD S127: full screen, over the 2D dashboard — the dashboard itself stays mounted
          so exiting returns to it with its own state intact (S129). */}
      {threeDView && (
        <div
          className="three-d-overlay"
          data-closing={threeDClosing ? 'true' : undefined}
          onAnimationEnd={(): void => {
            if (threeDClosing) finishCloseThreeDView();
          }}
        >
          <ThreeDViewPanel />
        </div>
      )}
    </div>
  );
}
