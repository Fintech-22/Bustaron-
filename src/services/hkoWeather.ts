import { M3_API_BASE } from './dataBackend';

/**
 * Client view of the M3 server's HKO snapshot (`GET /api/weather`, PRD §5.2).
 *
 * The SERVER owns the HKO integration (5-minute poll, cache, STALE flag, typhoon
 * gate, genesis anchor — FR-W1..W5); the client only renders it. Field names mirror
 * `server/weather.py`'s `HkoSnapshot` plus the four evidence fields `/api/weather`
 * adds on top (`dispatchBlocked`, `pathCostFactor`, `cachedSnapshotHash`,
 * `genesisWeather`, `genesisMatchesCache`). Every null means "HKO did not report
 * this" — the UI must say so, never fabricate a dash-filler number.
 */

export interface HkoWarning {
  code: string;
  name: string | null;
  type: string | null;
}

/** The genesis `WEATHER` transaction's anchored record (PRD S40, FR-W5). */
export interface GenesisWeatherRecord {
  snapshotHash: string | null;
  source: string;
  observedAt?: string | null;
  windKmh?: number | null;
  typhoonSignal?: number;
  note?: string;
}

export interface HkoWeather {
  source: string;
  fetchedAtMs: number;
  observedAt: string | null;
  stale: boolean;
  ageS: number;
  windKmh: number | null;
  windGustKmh: number | null;
  windStation: string | null;
  windDirection: string | null;
  stationCount: number;
  temperatureC: number | null;
  humidityPct: number | null;
  typhoonSignal: number;
  typhoonCode: string | null;
  warnings: HkoWarning[];
  note: string | null;
  /** S38: Signal 8+ refuses dispatch (a STALE snapshot blocks nothing). */
  dispatchBlocked: boolean;
  /** S36: the wind penalty the agents apply to path cost. */
  pathCostFactor: number;
  cachedSnapshotHash: string;
  genesisWeather: GenesisWeatherRecord | null;
  genesisMatchesCache: boolean;
}

/**
 * Fetches the snapshot. Throws with the server's own `detail` when it answers with
 * an error body — the same defensive read `m3Backend.ts` uses, because a non-ok body
 * is NOT guaranteed to be a JSON object.
 */
export async function fetchHkoWeather(baseUrl: string = M3_API_BASE): Promise<HkoWeather> {
  const response = await fetch(`${baseUrl}/api/weather`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch((): null => null);
    const detail =
      typeof body === 'object' && body !== null && typeof (body as { detail?: unknown }).detail === 'string'
        ? (body as { detail: string }).detail
        : null;
    throw new Error(detail ?? `/api/weather failed: ${response.status}`);
  }
  return (await response.json()) as HkoWeather;
}

/** The HKO CSV's own timestamp format is `YYYYMMDDHHMM`; rendered for humans. */
export function formatObservedAt(observedAt: string | null): string {
  if (observedAt === null || !/^\d{12}$/.test(observedAt)) {
    return 'unknown';
  }
  return `${observedAt.slice(0, 4)}-${observedAt.slice(4, 6)}-${observedAt.slice(6, 8)} ${observedAt.slice(8, 10)}:${observedAt.slice(10, 12)} HKT`;
}
