/**
 * Async telemetry orchestrator — PRD §5.2 / STAGE 3.
 *
 * Coordinates data fetching from the M3 FastAPI server (http://127.0.0.1:8000)
 * with aggressive retry-on-failure and TTL-based refresh-on-success.
 *
 * Retry strategy (per user clarification):
 *  — On SUCCESS: refresh after the TTL (5 minutes for weather, 60s for status)
 *  — On FAILURE: retry every 5 seconds until the server comes back
 *
 * Pipeline sequence (PRD S35→S37→S39→S40):
 *  1. Weather: GET /api/weather → cached HKO snapshot
 *  2. S37 wind evidence: the snapshot's `windKmh` feeds the negotiation engine
 *  3. S39 STALE flag: `stale === true` when the cache is expired/unreachable
 *  4. S40 genesis anchor: `genesisWeather` records the hash at chain mint time
 */

import { M3_API_BASE } from './dataBackend';

export type PipelineStage = 'weather' | 'wind-evidence' | 'stale-flag' | 'genesis-anchor';

export interface PipelineStatus {
  stage: PipelineStage;
  verified: boolean;
  detail: string;
}

export interface TelemetryState {
  serverOnline: boolean;
  weather: unknown | null;
  pipeline: PipelineStatus[];
  lastError: string | null;
  lastSuccessMs: number | null;
}

const RETRY_MS = 5_000;
const WEATHER_TTL_MS = 300_000; // 5 minutes (PRD S35)
const HEALTH_TTL_MS = 30_000;

type Listener = (state: TelemetryState) => void;

/**
 * Manages the polling lifecycle for M3 server telemetry.
 * A single instance is shared across components — call `start()` on mount
 * and `stop()` when no components need it.
 */
export class TelemetryOrchestrator {
  private state: TelemetryState;
  private listeners: Set<Listener> = new Set();
  private weatherTimer = 0;
  private healthTimer = 0;
  private running = false;

  constructor(private baseUrl: string = M3_API_BASE) {
    this.state = {
      serverOnline: false,
      weather: null,
      pipeline: this.initialPipeline(),
      lastError: null,
      lastSuccessMs: null,
    };
  }

  private initialPipeline(): PipelineStatus[] {
    return [
      { stage: 'weather', verified: false, detail: 'Waiting for server connection…' },
      { stage: 'wind-evidence', verified: false, detail: 'Requires live weather snapshot' },
      { stage: 'stale-flag', verified: false, detail: 'Requires last-good cache' },
      { stage: 'genesis-anchor', verified: false, detail: 'Visible once connected' },
    ];
  }

  getState(): TelemetryState {
    return { ...this.state, pipeline: [...this.state.pipeline] };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pollWeather();
    void this.pollHealth();
  }

  stop(): void {
    this.running = false;
    if (this.weatherTimer) window.clearTimeout(this.weatherTimer);
    if (this.healthTimer) window.clearTimeout(this.healthTimer);
  }

  private async pollHealth(): Promise<void> {
    if (!this.running) return;
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        this.state.serverOnline = true;
      } else {
        this.state.serverOnline = false;
      }
    } catch {
      this.state.serverOnline = false;
    }
    this.notify();
    this.healthTimer = window.setTimeout(() => void this.pollHealth(), HEALTH_TTL_MS);
  }

  private async pollWeather(): Promise<void> {
    if (!this.running) return;

    try {
      const res = await fetch(`${this.baseUrl}/api/weather`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const body: unknown = await res.json().catch((): null => null);
        const detail =
          typeof body === 'object' && body !== null && typeof (body as { detail?: unknown }).detail === 'string'
            ? (body as { detail: string }).detail
            : null;
        throw new Error(detail ?? `/api/weather returned ${res.status}`);
      }

      const weather = await res.json();
      this.state = {
        serverOnline: true,
        weather,
        pipeline: this.derivePipeline(weather),
        lastError: null,
        lastSuccessMs: Date.now(),
      };
      this.notify();

      // Success: refresh after the TTL (5 minutes per PRD S35)
      this.weatherTimer = window.setTimeout(() => void this.pollWeather(), WEATHER_TTL_MS);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.state = {
        ...this.state,
        serverOnline: false,
        weather: null,
        pipeline: this.initialPipeline(),
        lastError: msg,
      };
      this.notify();

      // Failure: retry in 5 seconds
      this.weatherTimer = window.setTimeout(() => void this.pollWeather(), RETRY_MS);
    }
  }

  private derivePipeline(weather: Record<string, unknown>): PipelineStatus[] {
    const stale = weather.stale === true;
    const windKmh = weather.windKmh;
    const genesis = weather.genesisWeather;
    const genesisMatches = weather.genesisMatchesCache === true;

    return [
      {
        stage: 'weather',
        verified: true,
        detail: stale ? 'Snapshot served from cache (STALE)' : 'Live HKO snapshot received',
      },
      {
        stage: 'wind-evidence',
        verified: windKmh !== null && windKmh !== undefined,
        detail:
          windKmh !== null && windKmh !== undefined
            ? `Wind ${windKmh} km/h available for negotiation evidence (S37)`
            : 'Wind data absent — negotiation evidence unavailable',
      },
      {
        stage: 'stale-flag',
        verified: true,
        detail: stale
          ? 'STALE: serving last-good cache (server unreachable or cache expired)'
          : 'Fresh: cache within TTL (S39)',
      },
      {
        stage: 'genesis-anchor',
        verified: genesis !== null && genesis !== undefined,
        detail:
          genesis === null || genesis === undefined
            ? 'No WEATHER transaction in genesis block'
            : genesisMatches
              ? 'Genesis hash matches current cache (S40)'
              : 'Cache has moved on since genesis (expected after refresh)',
      },
    ];
  }
}

/** Shared singleton — components subscribe to the same polling loop. */
let orchestrator: TelemetryOrchestrator | null = null;

export function getTelemetryOrchestrator(): TelemetryOrchestrator {
  if (orchestrator === null) {
    orchestrator = new TelemetryOrchestrator();
  }
  return orchestrator;
}
