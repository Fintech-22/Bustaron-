import type { CSSProperties } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { buildAnalyticsReport } from '../../services/analytics';
import type { AnalyticsReport } from '../../services/analytics';
import { buildSkyOccupancy24h, peakOccupancy, meanOccupancy } from '../../services/skyOccupancy';
import { SkyOccupancyChart } from '../charts/SkyOccupancyChart';
import type { Drone, Mission } from '../../types/domain';

/**
 * Analytics tab (PRD §11.2.2): 24-hour sky occupancy chart, flight efficiency
 * metrics and a cost analysis, scoped to the signed-in operator's own fleet and
 * routes (the whole system for an admin). The traffic heatmap has been replaced
 * by the 24-hour Sky Occupancy line chart per STAGE 4 brief.
 */
export function AnalyticsPanel(): JSX.Element {
  const drones = useDashboardStore((state) => state.drones);
  const missions = useDashboardStore((state) => state.missions);
  const zones = useDashboardStore((state) => state.zones);
  const wallets = useDashboardStore((state) => state.wallets);
  const activeRole = useDashboardStore((state) => state.activeRole);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);

  const operatorName = activeRole === 'admin' ? null : wallets.find((wallet) => wallet.id === currentOperatorId)?.operatorName ?? null;
  const scopedDrones: Drone[] = activeRole === 'admin' ? drones : drones.filter((drone: Drone): boolean => drone.operatorId === currentOperatorId);
  const scopedMissions: Mission[] = activeRole === 'admin' ? missions : missions.filter((m: Mission) => m.operator === operatorName);
  const report: AnalyticsReport = buildAnalyticsReport(scopedDrones, missions, zones, operatorName);

  // 24-hour sky occupancy series (STAGE 4).
  const occupancyData = buildSkyOccupancy24h(scopedDrones, scopedMissions);
  const peak = peakOccupancy(occupancyData);
  const mean = meanOccupancy(occupancyData);

  return (
    <section className="panel" aria-labelledby="analytics-panel-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Personal operations analytics</p>
          <h2 className="panel__title" id="analytics-panel-title">Analytics</h2>
        </div>
        <span className="badge" style={{ '--badge-color': 'var(--color-cyan)' } as CSSProperties}>
          {operatorName ?? 'System-wide'}
        </span>
      </div>

      <h3 className="panel__title">24-Hour Sky Occupancy</h3>
      <div
        className="analytics-chart-container"
        role="group"
        aria-label={`24-hour sky occupancy for ${operatorName ?? 'the whole system'}`}
      >
        <SkyOccupancyChart data={occupancyData} />
        <p className="helper-text">
          Peak occupancy {peak}% · Mean {mean}% · diurnal model blended with live fleet and mission data (STAGE 4 / PRD FR-OP-V4).
        </p>
      </div>

      <h3 className="panel__title spaced-top--lg">Flight efficiency</h3>
      <dl className="drone-detail-grid" aria-label="Flight efficiency metrics">
        <div className="detail-card"><dt>Sorties</dt><dd>{report.efficiency.sorties}</dd></div>
        <div className="detail-card"><dt>Track distance</dt><dd>{report.efficiency.totalDistanceKm} km</dd></div>
        <div className="detail-card"><dt>Mean cruise speed</dt><dd>{report.efficiency.averageSpeedKph} kph</dd></div>
        <div className="detail-card"><dt>Mean cruise altitude</dt><dd>{report.efficiency.averageAltitudeM} m</dd></div>
        <div className="detail-card"><dt>Fleet utilisation</dt><dd>{report.efficiency.utilisationPct}%</dd></div>
        <div className="detail-card"><dt>Mean battery</dt><dd>{report.efficiency.averageBatteryPct}%</dd></div>
      </dl>

      <h3 className="panel__title spaced-top--lg">Cost analysis</h3>
      <dl className="drone-detail-grid" aria-label="Cost analysis metrics">
        <div className="detail-card"><dt>Blended cost</dt><dd>{report.cost.creditsPerKm} cr/km</dd></div>
        <div className="detail-card"><dt>Route set cost</dt><dd>{report.cost.totalRouteCredits} cr</dd></div>
        <div className="detail-card"><dt>Projected monthly</dt><dd>{report.cost.projectedMonthlyCredits} cr</dd></div>
        <div className="detail-card"><dt>Costliest plan</dt><dd>{report.cost.highestCostMissionName ?? 'None'}</dd></div>
      </dl>

      {report.hotSpots.length > 0 && (
        <>
          <h3 className="panel__title spaced-top--lg">Busiest cells</h3>
          <ul className="status-list" aria-label="Busiest traffic cells">
            {report.hotSpots.map((cell) => (
              <li className="status-item" key={cell.id}>
                <div className="status-row">
                  <strong>Cell {cell.id}</strong>
                  <span className="badge" style={{ '--badge-color': 'var(--color-amber)' } as CSSProperties}>
                    occ {cell.occupancy.toFixed(2)}
                  </span>
                </div>
                <p className="helper-text">
                  {cell.center.lat.toFixed(3)}, {cell.center.lng.toFixed(3)} · risk {cell.risk} · wind {cell.windKph} km/h
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
