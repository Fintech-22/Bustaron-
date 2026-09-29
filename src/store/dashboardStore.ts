import { create } from 'zustand';
import { layerDefinitions } from '../config/layers';
import type {
  Alert,
  AppState,
  ApprovalRequest,
  CreditLedgerEntry,
  Drone,
  LayerId,
  Mission,
  NavSection,
  UserRole,
} from '../types/domain';
import type { AuthUser } from '../auth/authService';
import { listBackends, resolveBackend } from '../services/dataBackends';
import type { DataBackend } from '../services/dataBackend';
import { awardAuction, decideApproval, placeBid } from '../services/creditsService';
import type { ApprovalDecisionResult } from '../services/creditsService';
import { planRoute } from '../services/routePlanner';
import type { PlannedRoute } from '../services/routePlanner';
import { buildSkycells } from '../services/skycells';
import { evaluateZonesAtPoint } from '../services/geo/pointInPolygon';
import type { ZoneHit } from '../services/geo/pointInPolygon';
import { DEFAULT_ALTITUDE_BAND_M } from '../services/altitudeBands';
import type { BackendId } from '../services/dataBackend';
import { createMission, deleteMissionFromList, updateMissionList } from '../services/missionService';
import type { MissionDraft } from '../services/missionService';
import { deriveAlerts, preserveAcknowledgements } from '../services/alerts';
import type { ClosedCellSet } from '../services/skycells';

export interface DashboardStore extends AppState {
  activeRole: UserRole;
  activeSection: NavSection;
  /** PRD §7: authenticated session. null when logged out. */
  isAuthenticated: boolean;
  authUser: AuthUser | null;
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
  /** Derived real-time alert feed (PRD S115); acknowledgements persist by id. */
  alerts: Alert[];
  /**
   * PRD S126/S127: the full-screen 3D View is an OVERLAY over whichever 2D
   * section is active, not a section of its own. That is what makes S129's
   * "single button to exit" restore the exact dashboard you left — for both
   * roles — without a second navigation state to keep in sync.
   */
  threeDView: boolean;
  threeDClosing: boolean;
  initialize: () => void;
  setRole: (role: UserRole) => void;
  navigate: (section: NavSection) => void;
  /** PRD S126: opens the 3D View over the current 2D dashboard. */
  openThreeDView: () => void;
  /** PRD S129: the single exit back to the 2D dashboard. */
  closeThreeDView: () => void;
  /** Completes the 3D close after the fade-out animation. */
  finishCloseThreeDView: () => void;
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
  /** PRD S112: creates a flight plan from a draft and returns its new id. */
  addMission: (draft: MissionDraft) => string;
  /** PRD S112: applies a partial update to an existing flight plan. */
  updateMission: (id: string, patch: Partial<MissionDraft>) => void;
  /** PRD S112: deletes a flight plan by id. */
  deleteMission: (id: string) => void;
  /** PRD S115: marks one alert acknowledged. */
  acknowledgeAlert: (id: string) => void;
  /** PRD S115: acknowledges every outstanding alert. */
  acknowledgeAllAlerts: () => void;
  /** Admin action: close or reopen a skycell (blocks operator flight plans through it). */
  closedCells: ClosedCellSet;
  /** Toggle the closure state of a skycell by id. */
  toggleCellClosure: (cellId: string) => void;
  /** PRD §7: sets the authenticated session after successful login. */
  authenticate: (user: AuthUser) => void;
  /** PRD §7: clears the session and returns to the login page. */
  logout: () => void;
}

const initialBackend: DataBackend = resolveBackend('mock');
const initialState: AppState = initialBackend.loadInitialState();

/** Re-derives the alert feed while preserving prior acknowledgements by id. */
function alertsFrom(state: AppState, previous: Alert[]): Alert[] {
  const acknowledgedIds = new Set(
    previous.filter((alert: Alert): boolean => alert.acknowledged).map((alert: Alert): string => alert.id),
  );
  return preserveAcknowledgements(deriveAlerts(state.drones, state.weatherAlerts, state.lastUpdatedIso), acknowledgedIds);
}

const initialAlerts: Alert[] = deriveAlerts(initialState.drones, initialState.weatherAlerts, initialState.lastUpdatedIso);

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
  isAuthenticated: false,
  authUser: null,
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
  alerts: initialAlerts,
  threeDView: false,
  threeDClosing: false,
  closedCells: new Set<string>(),
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
      alerts: deriveAlerts(loadedState.drones, loadedState.weatherAlerts, loadedState.lastUpdatedIso),
      // A backend swap (hydrate) must never leave a stale 3D scene over fresh data.
      threeDView: false,
      closedCells: new Set<string>(),
    });
  },
  setRole: (role: UserRole): void => {
    // RBAC (PRD §7): an authenticated operator cannot escalate to admin.
    // Admins can switch freely between operator and admin perspectives.
    const authed = get().authUser;
    if (role === 'admin' && authed !== null && authed.role !== 'admin') {
      return;
    }
    const currentSection = get().activeSection;
    const adminOnlySections: NavSection[] = ['admin', 'approvals'];
    let nextSection: NavSection;
    if (role === 'admin') {
      nextSection = adminOnlySections.includes(currentSection) ? currentSection : 'admin';
    } else {
      nextSection = adminOnlySections.includes(currentSection) ? 'operations' : currentSection;
    }
    set({ activeRole: role, activeSection: nextSection, threeDView: false, threeDClosing: false });
  },
  navigate: (section: NavSection): void => set({ activeSection: section }),
  openThreeDView: (): void => set({ threeDView: true, threeDClosing: false }),
  closeThreeDView: (): void => set({ threeDClosing: true }),
  finishCloseThreeDView: (): void => set({ threeDView: false, threeDClosing: false }),
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
      alerts: alertsFrom(nextState, current.alerts),
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
      alerts: deriveAlerts(loadedState.drones, loadedState.weatherAlerts, loadedState.lastUpdatedIso),
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
        alerts: alertsFrom(serverState, get().alerts),
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
  /** PRD S112: create a flight plan from a draft; returns the new plan's id. */
  addMission: (draft: MissionDraft): string => {
    const state = get();
    const mission: Mission = createMission(draft, state.missions);
    set({ missions: [...state.missions, mission], lastError: null });
    return mission.id;
  },
  /** PRD S112: partial update of an existing flight plan. */
  updateMission: (id: string, patch: Partial<MissionDraft>): void => {
    const state = get();
    set({ missions: updateMissionList(state.missions, id, patch), lastError: null });
  },
  /** PRD S112: delete a flight plan. */
  deleteMission: (id: string): void => {
    const state = get();
    set({ missions: deleteMissionFromList(state.missions, id), lastError: null });
  },
  /** PRD S115: acknowledge one alert (state actually changes). */
  acknowledgeAlert: (id: string): void => {
    set({
      alerts: get().alerts.map((alert: Alert): Alert => (alert.id === id ? { ...alert, acknowledged: true } : alert)),
    });
  },
  /** PRD S115: acknowledge every outstanding alert. */
  acknowledgeAllAlerts: (): void => {
    set({ alerts: get().alerts.map((alert: Alert): Alert => ({ ...alert, acknowledged: true })) });
  },
  toggleCellClosure: (cellId: string): void => {
    const next = new Set(get().closedCells);
    if (next.has(cellId)) {
      next.delete(cellId);
    } else {
      next.add(cellId);
    }
    set({ closedCells: next });
  },
  authenticate: (user: AuthUser): void => {
    set({
      isAuthenticated: true,
      authUser: user,
      activeRole: user.role,
      activeSection: user.role === 'admin' ? 'admin' : 'operations',
      threeDView: false,
      threeDClosing: false,
    });
  },
  logout: (): void => {
    set({
      isAuthenticated: false,
      authUser: null,
      threeDView: false,
      threeDClosing: false,
      emergencyMode: false,
    });
  },
}));

/** Convenience helper used by the planning UI: runs A* against current zones. */
export function planDraftRoute(start: { lat: number; lng: number }, goal: { lat: number; lng: number }): void {
  const state = useDashboardStore.getState();
  const zones = state.zones;
  const skycells = buildSkycells(
    state.drones,
    state.missions,
    state.weatherAlerts,
    state.closedCells,
    zones.filter((z) => z.kind === 'rfz' || z.kind === 'sensitive').map((z) => z.polygon),
  );
  try {
    const route: PlannedRoute = planRoute(start, goal, { zones, skycells, closedCells: state.closedCells });
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
