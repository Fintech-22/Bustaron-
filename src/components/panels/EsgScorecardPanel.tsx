import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { MetricCard } from '../common/MetricCard';
import { useDashboardStore } from '../../store/dashboardStore';
import { buildEsgReport } from '../../services/esg';
import type { EsgReport } from '../../services/esg';
import type { RiskLevel } from '../../types/domain';

const riskColorByName: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

/**
 * ESG Scorecard tab (PRD §11.2.2): carbon per km, noise by zone, compliance
 * rate, privacy violations, recycling score and the fleet-weighted ESG
 * multiplier. All figures come from `buildEsgReport`, which derives them from
 * the live fleet, route set and zone pack.
 */
export function EsgScorecardPanel(): JSX.Element {
  const drones = useDashboardStore((state) => state.drones);
  const missions = useDashboardStore((state) => state.missions);
  const zones = useDashboardStore((state) => state.zones);

  const report: EsgReport = buildEsgReport(drones, missions, zones);
  const hasData = drones.length > 0 || missions.length > 0;

  return (
    <section className="panel" aria-labelledby="esg-scorecard-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Environmental, social and governance</p>
          <h2 className="panel__title" id="esg-scorecard-title">ESG Scorecard</h2>
        </div>
        <span
          className="badge"
          style={{ '--badge-color': 'var(--color-radar)', '--badge-border': 'var(--color-radar)' } as CSSProperties}
        >
          Grade {report.grade} · {report.esgMultiplier.toFixed(2)}×
        </span>
      </div>

      {!hasData ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No ESG signals"
          message="Carbon, noise and compliance metrics appear once a fleet and route set are loaded."
        />
      ) : (
        <>
          <div className="metric-grid" aria-label="ESG headline metrics">
            <MetricCard label="Carbon per km" value={`${report.carbonPerKmG} g`} trend={`${report.carbonKg} kg CO2e across ${report.totalDistanceKm} km`} tone="good" icon="CO2" />
            <MetricCard label="Compliance Rate" value={`${report.complianceRatePct}%`} trend={`${report.compliantMissions}/${report.totalMissions} plans clear of restricted airspace`} tone={report.complianceRatePct >= 90 ? 'good' : 'warning'} icon="CMP" />
            <MetricCard label="Privacy Violations" value={`${report.privacyViolations}`} trend="Sensitive-zone overflights" tone={report.privacyViolations === 0 ? 'good' : 'critical'} icon="PRV" />
            <MetricCard label="Recycling Score" value={`${report.recyclingScorePct}%`} trend="Mean battery-pack health across the fleet" tone="neutral" icon="REC" />
          </div>

          <h3 className="panel__title spaced-top--lg">Noise by zone</h3>
          <table className="data-table" aria-label="Noise exposure by zone class">
            <caption className="helper-text">Representative dB(A) at 100 m overflight per zone class.</caption>
            <thead>
              <tr>
                <th scope="col">Zone class</th>
                <th scope="col">Zones</th>
                <th scope="col">dB(A) @ 100 m</th>
                <th scope="col">Exposure</th>
              </tr>
            </thead>
            <tbody>
              {report.noiseByZone.map((band) => (
                <tr key={band.zoneKind}>
                  <th scope="row">{band.label}</th>
                  <td>{band.zoneCount}</td>
                  <td>{band.db === 0 ? 'No overflight' : band.db}</td>
                  <td>
                    <span
                      className="badge"
                      style={{ '--badge-color': riskColorByName[band.level], '--badge-border': riskColorByName[band.level] } as CSSProperties}
                    >
                      {band.level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="helper-text spaced-top">
            ESG multiplier {report.esgMultiplier.toFixed(2)}× is fleet-weighted from the compliance rate, carbon intensity and privacy record; it
            scales the operator's slot-auction credit allowance.
          </p>
        </>
      )}
    </section>
  );
}
