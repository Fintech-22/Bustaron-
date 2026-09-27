import type { AirspaceZone, AppState, Drone, Mission, WeatherAlert } from '../types/domain';
import { loadCadZones, loadCadZonesIntersecting } from './cadGeoJsonService';
import { M3_API_BASE } from './dataBackend';
import type { BackendId, DataBackend } from './dataBackend';
import { MockDataService } from './mockDataService';

/**
 * M3 backend: the FastAPI server (PRD §4.4, port 8000) behind the same
 * DataBackend seam. The server owns the hash-chained ledger plus persisted
 * auctions/approvals/wallets; zones/fleet/missions come from the server's
 * copy of the ingested CAD pack. If the server is unreachable the adapter
 * falls back to the CAD-offline composition so the shell still renders.
 */

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${M3_API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    // A non-ok body is NOT guaranteed to be a JSON object. FastAPI answers its
    // own errors with `{"detail": ...}`, but a proxy or a dead upstream can
    // return `null`, an array, or an empty body. `.catch()` only covers a parse
    // REJECTION — it does not cover a `null` RESOLUTION — so reading `.detail`
    // off the result threw a bare `TypeError: null is not an object` that hid
    // the real HTTP status (reproduced by running `probe_m3_seam.ts` with the
    // server down). Read the body defensively and fall back to the status.
    const body: unknown = await response.json().catch((): null => null);
    const detail =
      typeof body === 'object' && body !== null && typeof (body as { detail?: unknown }).detail === 'string'
        ? (body as { detail: string }).detail
        : null;
    throw new Error(detail ?? `${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface ChainHealth {
  status: string;
  chainHeight: number;
  chainValid: boolean;
  auctions: number;
  approvals: number;
  wallets: number;
}

export interface ServerAuction {
  id: string;
  slotName: string;
  corridorZoneId: string;
  windowStartIso: string;
  windowEndIso: string;
  reserveCredits: number;
  status: 'open' | 'awarded' | 'settled' | 'cancelled';
  bids: { id: string; walletId: string; bidder: string; credits: number; submittedIso: string }[];
  winningBidId: string | null;
}

export interface ServerApproval {
  id: string;
  missionName: string;
  operator: string;
  walletId: string;
  requestedAtIso: string;
  status: 'pending' | 'approved' | 'rejected';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  creditsEscrowed: number;
  reason: string;
  decisionReason: string | null;
}

export interface ServerWallet {
  id: string;
  operatorName: string;
  balanceCredits: number;
  reservedCredits: number;
}

export interface ServerLedgerEntry {
  id: string;
  walletId: string;
  deltaCredits: number;
  reason: string;
  atIso: string;
  /** Anchoring block hash, stamped by `submit_tx` (PRD S113 on-chain tx hash). */
  txHash?: string;
}

/** Submits a transaction and anchors it on the server's chain. */
export async function submitTx(type: string, payload: Record<string, unknown>): Promise<{ blockHeight: number; blockHash: string }> {
  return fetchJson<{ ok: boolean; blockHeight: number; blockHash: string }>('/chain/tx', {
    method: 'POST',
    body: JSON.stringify({ type, payload }),
  });
}

export async function fetchHealth(): Promise<ChainHealth> {
  return fetchJson<ChainHealth>('/api/health');
}

function composeFromServer(serverState: {
  auctions: ServerAuction[];
  approvals: ServerApproval[];
  wallets: ServerWallet[];
  ledger: ServerLedgerEntry[];
}): AppState {
  const mock = new MockDataService().loadInitialState();
  const zones = loadCadZones();
  return {
    ...mock,
    zones,
    wallets: serverState.wallets,
    auctions: serverState.auctions,
    approvalRequests: serverState.approvals.map((approval) => ({
      ...approval,
      decisionReason: approval.decisionReason ?? undefined,
    })),
    // PRD S113: the server ledger carries the real anchoring block hash, so the
    // wallet's tx hashes are on-chain rather than content-addressed offline.
    creditLedger: serverState.ledger,
  };
}

/**
 * Live M3 adapter. All load* calls hit the server; simulateTick re-hydrates
 * from the server (positions stay mock until the ESP32 telemetry feed lands).
 */
export class M3Backend implements DataBackend {
  readonly id: BackendId = 'm3-server';
  readonly offlineCapable = false;
  readonly usesIngestedGeodata = true;

  private readonly mockService = new MockDataService();
  private labelValue = 'M3 FastAPI server';

  get label(): string {
    return this.labelValue;
  }

  async refreshLabel(): Promise<void> {
    try {
      const health = await fetchHealth();
      this.labelValue = `M3 server · chain h=${health.chainHeight}${health.chainValid ? '' : ' · TAMPERED'}`;
    } catch {
      this.labelValue = 'M3 server (offline)';
    }
  }

  /** Sync fallback: last-known offline composition (used before hydrate resolves). */
  loadInitialState(): AppState {
    if (this.cachedState) {
      return this.cachedState;
    }
    const mock = this.mockService.loadInitialState();
    const { zones: _zones, ...base } = mock;
    void _zones;
    return { ...base, zones: loadCadZones() };
  }

  private cachedState: AppState | null = null;

  /** Async hydration from the live server; falls back offline gracefully. */
  async hydrate(): Promise<AppState> {
    try {
      const [auctions, approvals, wallets, ledger] = await Promise.all([
        fetchJson<ServerAuction[]>('/api/auctions'),
        fetchJson<ServerApproval[]>('/api/approvals'),
        fetchJson<ServerWallet[]>('/api/wallets'),
        fetchJson<ServerLedgerEntry[]>('/api/ledger'),
      ]);
      await this.refreshLabel();
      this.cachedState = composeFromServer({ auctions, approvals, wallets, ledger });
      return this.cachedState;
    } catch {
      // Server unreachable: degrade to the offline CAD composition.
      this.labelValue = 'M3 server (offline)';
      const mock = this.mockService.loadInitialState();
      const { zones: _zones, ...base } = mock;
      void _zones;
      this.cachedState = { ...base, zones: loadCadZones() };
      return this.cachedState;
    }
  }

  loadZones(): AirspaceZone[] {
    return loadCadZones();
  }

  listZones(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): AirspaceZone[] {
    return loadCadZonesIntersecting(bounds);
  }

  loadFleet(): Drone[] {
    return this.mockService.loadInitialState().drones;
  }

  loadMissions(): Mission[] {
    return this.mockService.loadInitialState().missions;
  }

  loadWeatherAlerts(): WeatherAlert[] {
    return this.mockService.loadInitialState().weatherAlerts;
  }

  simulateTick(state: AppState): AppState {
    // The tick stays local until the ESP32 telemetry feed lands in M3; the
    // server-persisted credit state is re-merged so ledger-driven changes win.
    const ticked = this.mockService.simulateTick(state);
    return { ...ticked, zones: loadCadZones() };
  }
}
