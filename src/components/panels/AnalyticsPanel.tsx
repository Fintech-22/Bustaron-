import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import { buildAnalyticsReport } from '../../services/analytics';
import type { AnalyticsReport } from '../../services/analytics';
import { HK_VIEW_BOUNDS } from '../../services/mapProjection';
import { skycellBandColor } from '../../services/skycells';
import type { Skycell } from '../../services/skycells';
import type { Drone, GeoPoint } from '../../types/domain';

/** Unclamped view-box projection so adjacent heatmap cells tile without gaps. */
function toViewBox(point: GeoPoint): { x: number; y: number } {
  const x = ((point.lng - HK_VIEW_BOUNDS.minLng) / (HK_VIEW_BOUNDS.maxLng - HK_VIEW_BOUNDS.minLng)) * 100;
  const y = (1 - (point.lat - HK_VIEW_BOUNDS.minLat) / (HK_VIEW_BOUNDS.maxLat - HK_VIEW_BOUNDS.minLat)) * 100;
  return { x, y };
}

const BAND_OPACITY: Record<Skycell['band'], number> = {
  clear: 0.05,
  light: 0.35,
  busy: 0.6,
  congested: 0.85,
};

/**
 * Analytics tab (PRD §11.2.2): a personal traffic heatmap, flight efficiency
 * metrics and a cost analysis, scoped to the signed-in operator's own fleet and
 * routes (the whole system for an admin).
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
  const report: AnalyticsReport = buildAnalyticsReport(scopedDrones, missions, zones, operatorName);

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

      <h3 className="panel__title">Personal traffic heatmap</h3>
      {report.heatmap.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No traffic to map"
          message="Traffic cells appear once your fleet or route set is populated."
        />
      ) : (
        <div
          className="heatmap"
          role="group"
          aria-label={`Traffic heatmap for ${operatorName ?? 'the whole system'}`}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <rect width="100" height="100" fill="#07101a" />
            {report.heatmap.map((cell: Skycell) => {
              // ring[0] = [westLng, southLat], ring[2] = [eastLng, northLat].
              const northWest = toViewBox({ lat: cell.ring[2][1], lng: cell.ring[0][0] });
              const southEast = toViewBox({ lat: cell.ring[0][1], lng: cell.ring[2][0] });
              const width = Math.max(0.2, southEast.x - northWest.x);
              const height = Math.max(0.2, southEast.y - northWest.y);
              return (
                <rect
                  key={cell.id}
                  x={northWest.x}
                  y={northWest.y}
                  width={width}
                  height={height}
                  fill={skycellBandColor[cell.band]}
                  opacity={BAND_OPACITY[cell.band]}
                />
              );
            })}
          </svg>
          <p className="helper-text">
            Peak occupancy {report.maxOccupancy} · green clear, yellow light, orange busy, red congested (PRD FR-OP-V4).
          </p>
        </div>
      )}

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
            {report.hotSpots.map((cell: Skycell) => (
              <li className="status-item" key={cell.id}>
                <div className="status-row">
                  <strong>Cell {cell.id}</strong>
                  <span className="badge" style={{ '--badge-color': skycellBandColor[cell.band], '--badge-border': skycellBandColor[cell.band] } as CSSProperties}>
                    {cell.band}
                  </span>
                </div>
                <p className="helper-text">
                  {cell.center.lat.toFixed(3)}, {cell.center.lng.toFixed(3)} · occupancy {cell.occupancy.toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
