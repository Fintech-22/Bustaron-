import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';
import { authAdmin } from './authHelper';

/**
 * HKO Weather tab (PRD §5.2, S35–S40). The SERVER owns the poller/cache/gate —
 * server-side evidence lives in `probe_weather.py` — so this suite pins the client
 * contract: the tab renders the snapshot honestly (nulls stay null, STALE is shown,
 * the S38 gate is spelled out), and offline it says which criteria are unverifiable
 * instead of going blank.
 */

function serverSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'HKO',
    fetchedAtMs: Date.now() - 31_000,
    observedAt: '202609271410',
    stale: false,
    ageS: 31.2,
    windKmh: 26,
    windGustKmh: 42,
    windStation: 'Ngong Ping',
    windDirection: 'E',
    stationCount: 25,
    temperatureC: 29.5,
    humidityPct: 78,
    uvIndex: 7,
    uvDesc: 'high',
    rainfallMm: 0,
    warningMessage: null,
    typhoonSignal: 0,
    typhoonCode: null,
    warnings: [],
    note: null,
    dispatchBlocked: false,
    pathCostFactor: 1.08,
    cachedSnapshotHash: 'a'.repeat(64),
    genesisWeather: { snapshotHash: 'a'.repeat(64), source: 'HKO', windKmh: 26, typhoonSignal: 0 },
    genesisMatchesCache: true,
    ...overrides,
  };
}

async function openWeatherTab(): Promise<void> {
  const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
  fireEvent.click(within(sidebar).getByRole('button', { name: /3d view/i }));
}

beforeEach((): void => {
  act((): void => {
    useDashboardStore.getState().initialize();
    authAdmin();
  });
  render(<App />);
});

afterEach((): void => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HKO Weather tab (PRD §5.2 client view)', () => {
  it('renders the live snapshot: wind, temperature, gate, cost factor, genesis anchor', async () => {
    const hko = await import('../services/hkoWeather');
    vi.spyOn(hko, 'fetchHkoWeather').mockResolvedValue(serverSnapshot() as never);

    await openWeatherTab();

    const panel = await screen.findByTestId('weather-panel');
    expect(panel.getAttribute('data-stale')).toBe('false');
    expect(panel.textContent).toContain('26 km/h');
    expect(panel.textContent).toContain('Ngong Ping');
    expect(panel.textContent).toContain('29.5 °C');
    expect(panel.textContent).toContain('×1.08');
    expect(panel.textContent).toContain('Open (no blocking signal)');
    expect(screen.getByTestId('genesis-match')).toBeInTheDocument();
    // Observed timestamp rendered from the HKO CSV format.
    expect(panel.textContent).toContain('2026-09-27 14:10 HKT');
  });

  it('shows the STALE flag and the S38 refusal when a blocking signal is in force', async () => {
    const hko = await import('../services/hkoWeather');
    vi.spyOn(hko, 'fetchHkoWeather').mockResolvedValue(
      serverSnapshot({
        stale: true,
        typhoonSignal: 8,
        typhoonCode: 'TC8NE',
        dispatchBlocked: true,
        pathCostFactor: 1.21,
        windKmh: 61,
      }) as never,
    );

    await openWeatherTab();

    const panel = await screen.findByTestId('weather-panel');
    expect(panel.getAttribute('data-stale')).toBe('true');
    expect(screen.getByText('STALE')).toBeInTheDocument();
    expect(panel.textContent).toContain('Signal 8 (TC8NE)');
    expect(panel.textContent).toContain('BLOCKED — Signal 8 refuses dispatch');
    expect(panel.textContent).toContain('×1.21');
  });

  it('says which S-criteria are unverifiable when the server is unreachable', async () => {
    const hko = await import('../services/hkoWeather');
    vi.spyOn(hko, 'fetchHkoWeather').mockRejectedValue(new Error('/api/weather failed: connection refused'));

    await openWeatherTab();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/weather evidence unverifiable/i)).toBeInTheDocument();
    // One list item per unverifiable S-criterion (S35/S37/S39/S40).
    expect(document.querySelectorAll('.weather-panel__checks li')).toHaveLength(4);
    // No panel at all — a missing server must never render fabricated numbers.
    expect(screen.queryByTestId('weather-panel')).not.toBeInTheDocument();
  });

  it('renders nulls honestly instead of dash-filler numbers', async () => {
    const hko = await import('../services/hkoWeather');
    vi.spyOn(hko, 'fetchHkoWeather').mockResolvedValue(
      serverSnapshot({
        windKmh: null,
        temperatureC: null,
        humidityPct: null,
        windStation: null,
        windDirection: null,
        genesisWeather: null,
      }) as never,
    );

    await openWeatherTab();

    const panel = await screen.findByTestId('weather-panel');
    // Null wind renders an em-dash next to the label, never a fabricated number.
    expect(panel.textContent).toContain('max 10-min mean wind');
    expect(panel.textContent).toMatch(/—\s*\n?\s*max 10-min mean wind|—km\/h|—/);
    // Null genesis anchor renders the honest "no WEATHER transaction" line.
    expect(panel.textContent).toContain('No WEATHER transaction in the genesis block.');
  });
});
