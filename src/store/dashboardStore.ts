import { create } from 'zustand';
import { layerDefinitions } from '../data/mockData';
import type {
  AppState,
  ApprovalRequest,
  CreditLedgerEntry,
  Drone,
  LayerId,
  NavSection,
  UserRole,
} from '../types/domain';
import { listBackends, resolveBackend } from '../services/dataBackends';
import type { DataBackend } from '../services/dataBackend';
import { awardAuction, decideApproval, placeBid } from '../services/creditsService';
import type { ApprovalDecisionResult } from '../services/creditsService';
import { planRoute } from '../services/routePlanner';
import type { PlannedRoute } from '../services/routePlanner';
import { evaluateZonesAtPoint } from '../services/geo/pointInPolygon';
import type { ZoneHit } from '../services/geo/pointInPolygon';
import { DEFAULT_ALTITUDE_BAND_M } from '../services/altitudeBands';
import type { BackendId } from '../services/dataBackend';

export interface DashboardStore extends AppState {
  activeRole: UserRole;
  activeSection: NavSection;
  selectedDroneId: string;
  activeLayers: Record<LayerId, boolean>;
  emergencyMode: boolean;
  flightDraftOpen: boolean;
  altitudeBandM: [number, number];
  /** Active map altitude-band filter (PRD FR-OP-V6). Null = all bands. */
  altitudeFilterM: [number, number] | null;
  /** The signed-in operator (PRD §11.3.3): operators see own drones only. */
  currentOperatorId: string;
  /** Identifier of the data backend feeding the shell (M2 adapter seam). */
  backendId: BackendId;
  /** Route planned by the A* service for the flight draft, if any. */
  plannedRoute: PlannedRoute | null;
  /** Restricted-zone hits along the current flight draft origin. */
  routeZoneHits: ZoneHit[];
  /** Error message from the last failed action (planning, bidding, decisions). */
  lastError: string | null;
  initialize: () => void;
  setRole: (role: UserRole) => void;
  navigate: (section: NavSection) => void;
  selectDrone: (id: string) => void;
  toggleLayer: (layer: LayerId) => void;
  /** PRD §11.3.3: impersonate an operator in the operator console. */
  setOperator: (operatorId: string) => void;
  /** PRD FR-OP-V6: engage/disengage the map altitude-band filter. */
  setAltitudeFilter: (band: [number, number] | null) => void;
  setAltitudeBand: (band: [number, number]) => void;
  startFlightDraft: () => void;
  clearFlightDraft: () => void;
  triggerEmergency: () => void;
  clearEmergency: () => void;
  tick: () => void;
  /** Switches the data backend and reloads operational state through the adapter. */
  setBackend: (id: BackendId) => void;
  /** Places a credit bid on an open slot auction. */
  bidOnAuction: (auctionId: string, walletId: string, credits: number) => void;
  /** Awards an open auction to its current top bid, releasing losing reservations. */
  awardTopBid: (auctionId: string) => void;
  /** Approves or rejects a pending flight approval request. */
  decideApprovalRequest: (requestId: string, decision: 'approved' | 'rejected', reason?: string) => void;
}

const initialBackend: DataBackend = resolveBackend('mock');
const initialState: AppState = initialBackend.loadInitialState();

const initialLayerState: Record<LayerId, boolean> = layerDefinitions.reduce(
  (layers: Record<LayerId, boolean>, layer): Record<LayerId, boolean> => ({
    ...layers,
    [layer.id]: true,
  }),
  {
    drones: true,
    routes: true,
    restrictedZones: true,
    weather: true,
    grid: true,
  },
);

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  ...initialState,
  activeRole: 'operator',
  activeSection: 'operations',
  selectedDroneId: initialState.drones[0]?.id ?? '',
  activeLayers: initialLayerState,
  emergencyMode: false,
  flightDraftOpen: false,
  altitudeBandM: [...DEFAULT_ALTITUDE_BAND_M] as [number, number],
  altitudeFilterM: null,
  currentOperatorId: 'wallet-harbour',
  backendId: initialBackend.id,
  plannedRoute: null,
  routeZoneHits: [],
  lastError: null,
  initialize: (): void => {
    const backend: DataBackend = resolveBackend(get().backendId);
    const loadedState: AppState = backend.loadInitialState();
    set({
      ...loadedState,
      selectedDroneId: loadedState.drones[0]?.id ?? '',
      activeRole: 'operator',
      activeSection: 'operations',
      activeLayers: initialLayerState,
      emergencyMode: false,
      flightDraftOpen: false,
      altitudeBandM: [...DEFAULT_ALTITUDE_BAND_M] as [number, number],
      altitudeFilterM: null,
      plannedRoute: null,
      routeZoneHits: [],
      lastError: null,
    });
  },
  setRole: (role: UserRole): void => {
    const currentSection = get().activeSection;
    const adminOnlySections: NavSection[] = ['admin', 'approvals'];
    let nextSection: NavSection;
    if (role === 'admin') {
      nextSection = adminOnlySections.includes(currentSection) ? currentSection : 'admin';
    } else {
      nextSection = adminOnlySections.includes(currentSection) ? 'operations' : currentSection;
    }
    set({ activeRole: role, activeSection: nextSection });
  },
  navigate: (section: NavSection): void => set({ activeSection: section }),
  selectDrone: (id: string): void => {
    const droneExists: boolean = get().drones.some((drone: Drone): boolean => drone.id === id);
    if (droneExists) {
      set({ selectedDroneId: id });
    }
  },
  toggleLayer: (layer: LayerId): void => {
    const currentLayers = get().activeLayers;
    set({ activeLayers: { ...currentLayers, [layer]: !currentLayers[layer] } });
  },
  /** PRD FR-OP-V6: engage/disengage the map altitude-band filter. */
  setAltitudeFilter: (band: [number, number] | null): void => set({ altitudeFilterM: band }),
  /** PRD §11.3.3: impersonate an operator in the operator console. */
  setOperator: (operatorId: string): void => set({ currentOperatorId: operatorId }),
  setAltitudeBand: (band: [number, number]): void => {
    // PRD FR-OP-V6: the ceiling reaches 400 m; the floor must stay below it.
    const lowerBound = Math.max(0, Math.min(band[0], band[1] - 10));
    const upperBound = Math.min(400, Math.max(band[1], lowerBound + 10));
    set({ altitudeBandM: [lowerBound, upperBound] });
  },
  startFlightDraft: (): void => set({ flightDraftOpen: true }),
  clearFlightDraft: (): void => set({ flightDraftOpen: false }),
  triggerEmergency: (): void => set({ emergencyMode: true }),
  clearEmergency: (): void => set({ emergencyMode: false }),
  tick: (): void => {
    const backend: DataBackend = resolveBackend(get().backendId);
    const current = get();
    const nextState: AppState = backend.simulateTick(current);
    set({
      drones: nextState.drones,
      missions: nextState.missions,
      zones: nextState.zones,
      weatherAlerts: nextState.weatherAlerts,
      complianceWidgets: nextState.complianceWidgets,
      systemWidgets: nextState.systemWidgets,
      wallets: nextState.wallets,
      auctions: nextState.auctions,
      approvalRequests: nextState.approvalRequests,
      creditLedger: nextState.creditLedger,
      lastUpdatedIso: nextState.lastUpdatedIso,
    });
  },
  setBackend: (id: BackendId): void => {
    const backend: DataBackend = resolveBackend(id);
    const loadedState: AppState = backend.loadInitialState();
    set({
      backendId: backend.id,
      drones: loadedState.drones,
      missions: loadedState.missions,
      zones: loadedState.zones,
      weatherAlerts: loadedState.weatherAlerts,
      complianceWidgets: loadedState.complianceWidgets,
      systemWidgets: loadedState.systemWidgets,
      wallets: loadedState.wallets,
      auctions: loadedState.auctions,
      approvalRequests: loadedState.approvalRequests,
      creditLedger: loadedState.creditLedger,
      lastUpdatedIso: loadedState.lastUpdatedIso,
      plannedRoute: null,
      routeZoneHits: [],
      lastError: null,
    });
    // Networked backends hydrate async; the sync composition above renders
    // immediately, then this replaces the server-persisted slices.
    void backend.hydrate?.().then((serverState: AppState): void => {
      if (get().backendId !== backend.id) return;
      set({
        wallets: serverState.wallets,
        auctions: serverState.auctions,
        approvalRequests: serverState.approvalRequests,
        creditLedger: serverState.creditLedger,
        drones: serverState.drones,
        missions: serverState.missions,
        lastUpdatedIso: serverState.lastUpdatedIso,
      });
    });
  },
  bidOnAuction: (auctionId: string, walletId: string, credits: number): void => {
    const state = get();
    try {
      const result = placeBid(state.auctions, state.wallets, auctionId, walletId, credits, state.lastUpdatedIso);
      set({ auctions: result.auctions, wallets: result.wallets, lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : 'Bid failed' });
    }
  },
  awardTopBid: (auctionId: string): void => {
    const state = get();
    try {
      const result = awardAuction(state.auctions, state.wallets, auctionId, state.lastUpdatedIso);
      set({
        auctions: result.auctions,
        wallets: result.wallets,
        creditLedger: [...state.creditLedger, ...result.ledgerEntries],
        lastError: null,
      });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : 'Award failed' });
    }
  },
  decideApprovalRequest: (requestId: string, decision: 'approved' | 'rejected', reason?: string): void => {
    const state = get();
    try {
      const result: ApprovalDecisionResult = decideApproval(
        state.approvalRequests,
        state.wallets,
        requestId,
        decision,
        state.lastUpdatedIso,
        reason,
      );
      const nextApprovals: ApprovalRequest[] = state.approvalRequests.map((entry: ApprovalRequest): ApprovalRequest =>
        entry.id === requestId ? result.approval : entry,
      );
      const nextLedger: CreditLedgerEntry[] = [...state.creditLedger, ...result.ledgerEntries];
      set({ approvalRequests: nextApprovals, wallets: result.wallets, creditLedger: nextLedger, lastError: null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : 'Decision failed' });
    }
  },
}));

/** Convenience helper used by the planning UI: runs A* against current zones. */
export function planDraftRoute(start: { lat: number; lng: number }, goal: { lat: number; lng: number }): void {
  const zones = useDashboardStore.getState().zones;
  try {
    const route: PlannedRoute = planRoute(start, goal, { zones });
    const hits: ZoneHit[] = evaluateZonesAtPoint(start, zones, 120);
    useDashboardStore.setState({ plannedRoute: route, routeZoneHits: hits, lastError: null });
  } catch (error) {
    useDashboardStore.setState({
      plannedRoute: null,
      routeZoneHits: evaluateZonesAtPoint(start, zones, 120),
      lastError: error instanceof Error ? error.message : 'Planning failed',
    });
  }
}

export function listAvailableBackends(): DataBackend[] {
  return listBackends();
}
