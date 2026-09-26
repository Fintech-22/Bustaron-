import { create } from 'zustand';
import { layerDefinitions } from '../data/mockData';
import { mockDataService } from '../services/mockDataService';
import type { AppState, Drone, LayerId, NavSection, UserRole } from '../types/domain';

export interface DashboardStore extends AppState {
  activeRole: UserRole;
  activeSection: NavSection;
  selectedDroneId: string;
  activeLayers: Record<LayerId, boolean>;
  emergencyMode: boolean;
  flightDraftOpen: boolean;
  altitudeBandM: [number, number];
  initialize: () => void;
  setRole: (role: UserRole) => void;
  navigate: (section: NavSection) => void;
  selectDrone: (id: string) => void;
  toggleLayer: (layer: LayerId) => void;
  setAltitudeBand: (band: [number, number]) => void;
  startFlightDraft: () => void;
  clearFlightDraft: () => void;
  triggerEmergency: () => void;
  clearEmergency: () => void;
  tick: () => void;
}

const initialState: AppState = mockDataService.loadInitialState();

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
  altitudeBandM: [60, 160],
  initialize: (): void => {
    const loadedState: AppState = mockDataService.loadInitialState();
    set({
      ...loadedState,
      selectedDroneId: loadedState.drones[0]?.id ?? '',
      activeRole: 'operator',
      activeSection: 'operations',
      activeLayers: initialLayerState,
      emergencyMode: false,
      flightDraftOpen: false,
      altitudeBandM: [60, 160],
    });
  },
  setRole: (role: UserRole): void => {
    const nextSection: NavSection = role === 'admin' ? 'admin' : 'operations';
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
  setAltitudeBand: (band: [number, number]): void => {
    const lowerBound = Math.max(0, Math.min(band[0], band[1] - 10));
    const upperBound = Math.min(250, Math.max(band[1], lowerBound + 10));
    set({ altitudeBandM: [lowerBound, upperBound] });
  },
  startFlightDraft: (): void => set({ flightDraftOpen: true }),
  clearFlightDraft: (): void => set({ flightDraftOpen: false }),
  triggerEmergency: (): void => set({ emergencyMode: true }),
  clearEmergency: (): void => set({ emergencyMode: false }),
  tick: (): void => {
    const current = get();
    const nextState: AppState = mockDataService.simulateTick(current);
    set({
      drones: nextState.drones,
      missions: nextState.missions,
      zones: nextState.zones,
      weatherAlerts: nextState.weatherAlerts,
      complianceWidgets: nextState.complianceWidgets,
      systemWidgets: nextState.systemWidgets,
      lastUpdatedIso: nextState.lastUpdatedIso,
    });
  },
}));
