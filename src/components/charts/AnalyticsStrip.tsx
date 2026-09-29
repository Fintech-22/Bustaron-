import { useCallback, useEffect, useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { buildSkyOccupancy24h, peakOccupancy, meanOccupancy } from '../../services/skyOccupancy';
import { computeRiskScore } from '../../services/riskScore';
import { fetchHkoWeather } from '../../services/hkoWeather';
import type { HkoWeather } from '../../services/hkoWeather';
import { SkyOccupancyChart } from './SkyOccupancyChart';
import { RiskGauge } from './RiskGauge';
import type { Drone, Mission, AirspaceZone } from '../../types/domain';

/**
 * Analytics strip — renders below the main map on the Operations page
 * (STAGE 4 / PRD §11.2.2).
 *
 * Combines:
 *   — 24-hour Sky Occupancy line chart (replaces traffic heatmap on the ops page)
 *   — HK Airspace Risk Score dial gauge
 *   — KPI cards: Airspace Traffic, Safety Metrics, USS Performance
 *   — HKO wind / UV / rainfall integration strip
 */

const REFETCH_MS = 60_000;
const RETRY_MS = 5_000;

export function AnalyticsStrip(): JSX.Element {
  const activeRole = useDashboardStore((s) => s.activeRole);
  const drones = useDashboardStore((s) => s.drones);
  const missions = useDashboardStore((s) => s.missions);
  const zones = useDashboardStore((s) => s.zones);
  const weatherAlerts = useDashboardStore((s) => s.weatherAlerts);
  const wallets = useDashboardStore((s) => s.wallets);
  const alerts = useDashboardStore((s) => s.alerts);
  const closedCells = useDashboardStore((s) => s.closedCells);
  const currentOperatorId = useDashboardStore((s) => s.currentOperatorId);

  // HKO live weather (fetched from M3 server).
  const [hkoWeather, setHkoWeather] = useState<HkoWeather | null>(null);

  const loadWeather = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await fetchHkoWeather();
      setHkoWeather(snapshot);
    } catch {
      // Silent — the WeatherPanel handles error display.
    }
  }, []);

  useEffect(() => {
    void loadWeather();
    let timer = 0;
    const schedule = (ms: number): void => {
      timer = window.setInterval(() => void loadWeather(), ms);
    };
    schedule(hkoWeather === null ? RETRY_MS : REFETCH_MS);
    return (): void => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadWeather, hkoWeather === null]);

  // Scope data by role.
  const scopedDrones: Drone[] = activeRole === 'admin'
    ? drones
    : drones.filter((d: Drone) => d.operatorId === currentOperatorId);
  const scopedMissions: Mission[] = activeRole === 'admin'
    ? missions
    : missions.filter((m: Mission) => m.operator === wallets.find((w) => w.id === currentOperatorId)?.operatorName);

  // Sky occupancy 24h series.
  const occupancyData = buildSkyOccupancy24h(scopedDrones, scopedMissions);
  const peak = peakOccupancy(occupancyData);
  const mean = meanOccupancy(occupancyData);

  // Risk score.
  const riskScore = computeRiskScore({
    drones,
    weatherAlerts,
    zones,
    closedCellCount: closedCells.size,
  });

  // KPI metrics.
  const activeDrones = scopedDrones.filter((d: Drone) => d.status !== 'grounded').length;
  const airborneDrones = scopedDrones.filter((d: Drone) => d.speedKph > 0).length;
  const warningDrones = scopedDrones.filter(
    (d: Drone) => d.status === 'warning' || d.status === 'critical',
  ).length;
  const activeSorties = scopedMissions.filter((m: Mission) => m.status === 'active').length;
  const pendingAlerts = alerts.filter((a) => !a.acknowledged).length;
  const totalCredits = wallets.reduce(
    (sum, w) => sum + w.balanceCredits + w.reservedCredits,
    0,
  );
  const highRiskZones = zones.filter(
    (z: AirspaceZone) => z.riskLevel === 'high' || z.riskLevel === 'critical',
  ).length;

  // HKO wind integration.
  const windKmh = hkoWeather?.windKmh ?? null;
  const uvIndex = hkoWeather?.uvIndex ?? null;
  const rainfallMm = hkoWeather?.rainfallMm ?? null;
  const dispatchBlocked = hkoWeather?.dispatchBlocked ?? false;

  // Traffic metrics cards.
  const trafficCards = [
    { label: 'Active Drones', value: `${activeDrones}/${scopedDrones.length}`, tone: 'good' as const },
    { label: 'Airborne', value: `${airborneDrones}`, tone: 'neutral' as const },
    { label: 'Active Sorties', value: `${activeSorties}`, tone: 'neutral' as const },
    { label: 'Airspace Occupancy', value: `${mean}%`, tone: peak > 60 ? 'warning' as const : 'good' as const },
  ];

  // Safety metrics cards.
  const safetyCards = [
    { label: 'Risk Score', value: `${riskScore.score}`, tone: riskScore.score >= 50 ? 'warning' as const : 'good' as const },
    { label: 'Warning Drones', value: `${warningDrones}`, tone: warningDrones > 0 ? 'warning' as const : 'good' as const },
    { label: 'Alerts Outstanding', value: `${pendingAlerts}`, tone: pendingAlerts > 0 ? 'warning' as const : 'good' as const },
    { label: 'High-Risk Zones', value: `${highRiskZones}`, tone: highRiskZones > 0 ? 'warning' as const : 'good' as const },
  ];

  // USS Performance cards.
  const ussCards = [
    { label: 'Credits Pool', value: `${totalCredits}`, tone: 'neutral' as const },
    { label: 'Wind (HKO)', value: windKmh === null ? '—' : `${windKmh} km/h`, tone: (windKmh ?? 0) > 40 ? 'warning' as const : 'good' as const },
    { label: 'UV Index', value: uvIndex === null ? '—' : `${uvIndex}`, tone: (uvIndex ?? 0) >= 6 ? 'warning' as const : 'good' as const },
    { label: 'Dispatch', value: dispatchBlocked ? 'BLOCKED' : 'Open', tone: dispatchBlocked ? 'critical' as const : 'good' as const },
  ];

  return (
    <section className="analytics-strip" aria-label="Real-time airspace analytics">
      {/* Chart + Gauge row */}
      <div className="analytics-strip__charts">
        <div className="analytics-strip__chart-block">
          <div className="analytics-strip__chart-header">
            <h3 className="analytics-strip__title">24-Hour Sky Occupancy</h3>
            <span className="analytics-strip__badge">Peak {peak}% · Mean {mean}%</span>
          </div>
          <SkyOccupancyChart data={occupancyData} />
        </div>

        <div className="analytics-strip__gauge-block">
          <div className="analytics-strip__chart-header">
            <h3 className="analytics-strip__title">HK Airspace Risk Score</h3>
          </div>
          <RiskGauge risk={riskScore} />
          <div className="risk-gauge__factors" aria-label="Risk score factors">
            <span>Wind {riskScore.factors.wind}</span>
            <span>Fleet {riskScore.factors.drones}</span>
            <span>Zones {riskScore.factors.zones}</span>
            <span>Closures {riskScore.factors.closures}</span>
          </div>
        </div>

        {/* HKO wind integration strip */}
        <div className="analytics-strip__hko-block" aria-label="HKO weather integration">
          <h3 className="analytics-strip__title">HKO Live Weather</h3>
          {hkoWeather === null ? (
            <p className="helper-text">Connecting to M3 server…</p>
          ) : (
            <dl className="hko-strip__grid">
              <div>
                <dt>Wind</dt>
                <dd>{windKmh === null ? '—' : `${windKmh} km/h`}</dd>
              </div>
              <div>
                <dt>Gust</dt>
                <dd>{hkoWeather.windGustKmh === null ? '—' : `${hkoWeather.windGustKmh} km/h`}</dd>
              </div>
              <div>
                <dt>Temp</dt>
                <dd>{hkoWeather.temperatureC === null ? '—' : `${hkoWeather.temperatureC}°C`}</dd>
              </div>
              <div>
                <dt>Humidity</dt>
                <dd>{hkoWeather.humidityPct === null ? '—' : `${hkoWeather.humidityPct}%`}</dd>
              </div>
              <div>
                <dt>UV</dt>
                <dd>{uvIndex === null ? '—' : `${uvIndex} (${hkoWeather.uvDesc ?? '—'})`}</dd>
              </div>
              <div>
                <dt>Rainfall</dt>
                <dd>{rainfallMm === null ? '—' : `${rainfallMm} mm`}</dd>
              </div>
              <div>
                <dt>Typhoon</dt>
                <dd>{hkoWeather.typhoonSignal === 0 ? 'None' : `Sig ${hkoWeather.typhoonSignal}`}</dd>
              </div>
              <div>
                <dt>Dispatch</dt>
                <dd data-gate={dispatchBlocked ? 'blocked' : 'open'} className={dispatchBlocked ? 'hko-strip__blocked' : 'hko-strip__open'}>
                  {dispatchBlocked ? 'BLOCKED' : 'Open'}
                </dd>
              </div>
            </dl>
          )}
          {hkoWeather?.warningMessage !== null && hkoWeather?.warningMessage !== undefined && (
            <p className="hko-strip__warning" role="status">
              {hkoWeather.warningMessage}
            </p>
          )}
        </div>
      </div>

      {/* KPI cards row */}
      <div className="analytics-strip__kpis" aria-label="Key performance indicators">
        <div className="kpi-group" aria-label="Airspace traffic metrics">
          <p className="kpi-group__label">Airspace Traffic</p>
          <div className="kpi-group__cards">
            {trafficCards.map((card) => (
              <article key={card.label} className="kpi-card" data-tone={card.tone}>
                <p className="kpi-card__label">{card.label}</p>
                <p className="kpi-card__value">{card.value}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="kpi-group" aria-label="Safety metrics">
          <p className="kpi-group__label">Safety Metrics</p>
          <div className="kpi-group__cards">
            {safetyCards.map((card) => (
              <article key={card.label} className="kpi-card" data-tone={card.tone}>
                <p className="kpi-card__label">{card.label}</p>
                <p className="kpi-card__value">{card.value}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="kpi-group" aria-label="USS performance metrics">
          <p className="kpi-group__label">USS Performance</p>
          <div className="kpi-group__cards">
            {ussCards.map((card) => (
              <article key={card.label} className="kpi-card" data-tone={card.tone}>
                <p className="kpi-card__label">{card.label}</p>
                <p className="kpi-card__value">{card.value}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
