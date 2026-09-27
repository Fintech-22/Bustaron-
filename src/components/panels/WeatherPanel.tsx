import { useCallback, useEffect, useState } from 'react';
import { formatObservedAt, fetchHkoWeather } from '../../services/hkoWeather';
import type { HkoWeather } from '../../services/hkoWeather';
import { M3_API_BASE } from '../../services/dataBackend';

/**
 * HKO Weather tab (PRD §5.2 FR-W1..W5, S35–S40).
 *
 * Renders the M3 server's cached HKO snapshot. The server — not the browser — owns
 * the poller (5-min TTL), the cache with its STALE flag, the typhoon dispatch gate
 * and the genesis anchor; this tab is the honest window onto that evidence. Offline
 * (server unreachable) it shows exactly which S-criteria are unverifiable rather
 * than going blank, and retries every 5 s so a server started later is picked up
 * without a reload. Fresh data refetches every 60 s (the snapshot itself only
 * changes every 5 min; this keeps `ageS` live between server refreshes).
 */

const REFETCH_MS = 60_000;
const RETRY_MS = 5_000;

function formatAge(ageS: number): string {
  if (ageS < 90) {
    return `${Math.round(ageS)} s ago`;
  }
  if (ageS < 5400) {
    return `${Math.round(ageS / 60)} min ago`;
  }
  return `${(ageS / 3600).toFixed(1)} h ago`;
}

export function WeatherPanel(): JSX.Element {
  const [weather, setWeather] = useState<HkoWeather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await fetchHkoWeather();
      setWeather(snapshot);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll while mounted; interval depends on whether we have data (retry vs refresh).
    let timer = 0;
    const schedule = (ms: number): void => {
      timer = window.setInterval((): void => {
        void load();
      }, ms);
    };
    schedule(weather === null ? RETRY_MS : REFETCH_MS);
    return (): void => window.clearInterval(timer);
    // Re-arm only when connectivity class flips; a snapshot update must not reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, weather === null]);

  return (
    <section className="panel" aria-labelledby="weather-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">HKO open data · PRD §5.2</p>
          <h2 className="panel__title" id="weather-title">Weather</h2>
        </div>
        {weather !== null && (
          <span
            className="badge"
            style={{ '--badge-color': weather.stale ? 'var(--color-amber)' : 'var(--color-radar)' } as React.CSSProperties}
          >
            {weather.stale ? 'STALE' : 'Live'}
          </span>
        )}
      </div>

      {error !== null && (
        <div className="weather-panel__offline" role="alert">
          <strong>M3 server unreachable — weather evidence unverifiable.</strong>
          <p>{error}</p>
          <ul className="weather-panel__checks">
            <li data-state="unverifiable">S35 poll+cache: server-side, cannot observe offline</li>
            <li data-state="unverifiable">S37 agent wind evidence: requires live snapshot</li>
            <li data-state="unverifiable">S39 STALE flag: requires a last-good cache</li>
            <li data-state="unverifiable">S40 genesis anchor: visible once connected</li>
          </ul>
          <p className="helper-text">Retrying every 5 s · server: {M3_API_BASE}</p>
        </div>
      )}

      {loading && weather === null && error === null && <p className="helper-text">Loading HKO snapshot…</p>}

      {weather !== null && (
        <div className="weather-panel" data-testid="weather-panel" data-stale={weather.stale}>
          <div className="weather-panel__primary">
            <div>
              <p className="weather-panel__value">
                {weather.windKmh === null ? '—' : `${weather.windKmh} km/h`}
              </p>
              <p className="helper-text">
                max 10-min mean wind
                {weather.windStation === null ? '' : ` · ${weather.windStation}`}
                {weather.windDirection === null ? '' : ` (${weather.windDirection})`}
              </p>
            </div>
            <div>
              <p className="weather-panel__value">
                {weather.temperatureC === null ? '—' : `${weather.temperatureC} °C`}
              </p>
              <p className="helper-text">temperature</p>
            </div>
            <div>
              <p className="weather-panel__value">{weather.humidityPct === null ? '—' : `${weather.humidityPct}%`}</p>
              <p className="helper-text">humidity</p>
            </div>
          </div>

          <dl className="weather-panel__grid">
            <div>
              <dt>Gust</dt>
              <dd>{weather.windGustKmh === null ? '—' : `${weather.windGustKmh} km/h`}</dd>
            </div>
            <div>
              <dt>Typhoon signal</dt>
              <dd>
                {weather.typhoonSignal === 0
                  ? 'None in force'
                  : `Signal ${weather.typhoonSignal}${weather.typhoonCode === null ? '' : ` (${weather.typhoonCode})`}`}
              </dd>
            </div>
            <div>
              <dt>Stations reporting</dt>
              <dd>{weather.stationCount}</dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{formatObservedAt(weather.observedAt)}</dd>
            </div>
            <div>
              <dt>Snapshot age</dt>
              <dd>{formatAge(weather.ageS)}{weather.stale ? ' · STALE (last good cache)' : ''}</dd>
            </div>
            <div>
              <dt>S36 path-cost wind factor</dt>
              <dd>×{weather.pathCostFactor.toFixed(2)}</dd>
            </div>
            <div>
              <dt>S38 dispatch gate</dt>
              <dd data-gate={weather.dispatchBlocked ? 'blocked' : 'open'}>
                {weather.dispatchBlocked
                  ? `BLOCKED — Signal ${weather.typhoonSignal} refuses dispatch`
                  : 'Open (no blocking signal)'}
              </dd>
            </div>
          </dl>

          {weather.warnings.length > 0 && (
            <ul className="weather-panel__warnings" aria-label="HKO warnings in force">
              {weather.warnings.map((warning) => (
                <li key={warning.code}>
                  <strong>{warning.code}</strong>
                  {warning.name === null ? '' : ` — ${warning.name}`}
                </li>
              ))}
            </ul>
          )}

          <div className="weather-panel__anchor">
            <p className="nav-group__label">Genesis anchor (S40)</p>
            <p className="helper-text">
              {weather.genesisWeather === null ? (
                'No WEATHER transaction in the genesis block.'
              ) : weather.genesisWeather.snapshotHash === null ? (
                'Genesis recorded honestly that no cache existed when it was minted.'
              ) : (
                <>
                  Anchored snapshot hash <code>{weather.genesisWeather.snapshotHash.slice(0, 16)}…</code> —{' '}
                  {weather.genesisMatchesCache ? (
                    <span data-testid="genesis-match">matches the current cache</span>
                  ) : (
                    <span data-testid="genesis-drift">cache has moved on since genesis (expected after any refresh)</span>
                  )}
                </>
              )}
            </p>
          </div>

          {weather.note !== null && <p className="helper-text">{weather.note}</p>}
        </div>
      )}
    </section>
  );
}
