import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScene, type SceneController, type SceneCounts, type SceneStatus, type ThreeDLayerId } from './cesiumScene';
import { loadCesium, readCesiumEnv } from '../../services/cesiumLoader';
import { buildSkycells } from '../../services/skycells';
import { useDashboardStore } from '../../store/dashboardStore';
import type { Drone, LayerId } from '../../types/domain';

/**
 * 3D View tab — full-screen CesiumJS scene with a collapsible control panel.
 *
 * The canvas fills the entire viewport. The layer toggles and status info are
 * hidden by default; a small floating button reveals them as a slide-in panel.
 * The top bar is minimal — just a title and an exit button, both overlaying
 * the canvas without reducing the visible map area.
 */

interface ThreeDLayerToggle {
  id: ThreeDLayerId;
  label: string;
  description: string;
}

const TOGGLES: ThreeDLayerToggle[] = [
  { id: 'buildings', label: 'Buildings', description: 'HK 3D city model' },
  { id: 'terrain', label: 'Terrain', description: 'World Terrain (rebuilds scene)' },
  { id: 'restrictedZones', label: 'RFZs', description: 'Restricted flight zones' },
  { id: 'trails', label: 'Trails', description: 'Planned A* route' },
  { id: 'drones', label: 'Drones', description: 'Live drone markers' },
  { id: 'routes', label: 'Mission routes', description: 'Corridor polylines' },
  { id: 'weather', label: 'Weather', description: 'Rain cells + wind' },
  { id: 'grid', label: 'Skycells', description: 'Traffic heatmap volumes' },
];

const SHARED_LAYER_IDS: LayerId[] = ['drones', 'routes', 'restrictedZones', 'weather', 'grid'];

function isShared(layer: ThreeDLayerId): layer is LayerId {
  return (SHARED_LAYER_IDS as string[]).includes(layer);
}

interface ThreeDHandle {
  status: SceneStatus;
  counts: SceneCounts;
  layers: Record<string, boolean>;
}

export function ThreeDViewPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [status, setStatus] = useState<SceneStatus | null>(null);
  const [counts, setCounts] = useState<SceneCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [local3d, setLocal3d] = useState<Record<'buildings' | 'terrain' | 'trails', boolean>>({
    buildings: true,
    terrain: true,
    trails: true,
  });

  const closeThreeDView = useDashboardStore((state) => state.closeThreeDView);
  const storeLayers = useDashboardStore((state) => state.activeLayers);
  const toggleLayer = useDashboardStore((state) => state.toggleLayer);
  const activeRole = useDashboardStore((state) => state.activeRole);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);
  const dronesAll = useDashboardStore((state) => state.drones);
  const missions = useDashboardStore((state) => state.missions);
  const zones = useDashboardStore((state) => state.zones);
  const weatherAlerts = useDashboardStore((state) => state.weatherAlerts);
  const plannedRoute = useDashboardStore((state) => state.plannedRoute);
  const closedCells = useDashboardStore((state) => state.closedCells);

  const env = useMemo(() => readCesiumEnv(), []);
  const drones = useMemo(
    () =>
      activeRole === 'admin' || currentOperatorId === null
        ? dronesAll
        : dronesAll.filter((drone: Drone): boolean => drone.operatorId === currentOperatorId),
    [activeRole, currentOperatorId, dronesAll],
  );
  const skycells = useMemo(() => {
    const rfzPolygons = zones
      .filter((z) => z.kind === 'rfz' || z.kind === 'sensitive')
      .map((z) => z.polygon);
    return buildSkycells(drones, missions, weatherAlerts, closedCells, rfzPolygons);
  }, [drones, missions, weatherAlerts, closedCells, zones]);
  const layers = useMemo<Record<ThreeDLayerId, boolean>>(
    () => ({ ...storeLayers, ...local3d }),
    [storeLayers, local3d],
  );

  const terrainOn = local3d.terrain;
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    setError(null);
    const build = async (): Promise<void> => {
      try {
        await loadCesium();
        const scene = await buildScene({
          container,
          zones,
          drones,
          missions,
          weatherAlerts,
          skycells,
          plannedRoute: plannedRoute?.waypoints ?? null,
          env: terrainOn ? env : { ...env, ionToken: null },
        });
        if (cancelled) {
          scene.destroy();
          return;
        }
        controllerRef.current = scene;
        setStatus(scene.status);
        setCounts(scene.counts);
        for (const toggle of TOGGLES) {
          scene.setLayer(toggle.id, layers[toggle.id]);
        }
        (window as unknown as { __bustaron3d?: ThreeDHandle }).__bustaron3d = {
          status: scene.status,
          counts: scene.counts,
          layers: { ...layers },
        };
      } catch (reason: unknown) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    };
    void build();
    return (): void => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      delete (window as unknown as { __bustaron3d?: ThreeDHandle }).__bustaron3d;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainOn, zones, drones, missions, weatherAlerts, skycells, plannedRoute]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (controller === null) {
      return;
    }
    for (const toggle of TOGGLES) {
      controller.setLayer(toggle.id, layers[toggle.id]);
    }
    const handle = (window as unknown as { __bustaron3d?: ThreeDHandle }).__bustaron3d;
    if (handle) {
      handle.layers = { ...layers };
    }
  }, [layers, status, counts]);

  const onToggle = (layer: ThreeDLayerId): void => {
    if (isShared(layer)) {
      toggleLayer(layer);
      return;
    }
    setLocal3d((current) => ({ ...current, [layer]: !current[layer] }));
  };

  const buildingsUnavailable = status !== null && status.buildings === 'unavailable';

  return (
    <section className="three-d three-d--fullscreen" aria-label="3D View">
      {/* Full-screen canvas */}
      <div className="three-d__canvas" ref={containerRef} data-testid="three-d-canvas" />

      {/* Floating top bar — minimal, overlays the canvas */}
      <div className="three-d__topbar">
        <div className="three-d__topbar-info">
          <p className="three-d__eyebrow">Situational awareness</p>
          <h2 className="three-d__title">
            {status === null ? 'Loading…' : sceneTitle(status)}
          </h2>
        </div>
        <button type="button" className="three-d__exit" onClick={closeThreeDView}>
          Exit 3D
        </button>
      </div>

      {/* Floating toggle button for the control panel */}
      <button
        type="button"
        className={`three-d__panel-toggle ${panelOpen ? 'three-d__panel-toggle--open' : ''}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-expanded={panelOpen}
        aria-label={panelOpen ? 'Hide layer controls' : 'Show layer controls'}
      >
        {panelOpen ? '×' : '☰'}
      </button>

      {/* Slide-in control panel */}
      <div className={`three-d__panel ${panelOpen ? 'three-d__panel--open' : ''}`} role="group" aria-label="3D layer controls">
        <p className="nav-group__label">Layers</p>
        {TOGGLES.map((toggle) => (
          <button
            key={toggle.id}
            type="button"
            className="layer-button"
            aria-pressed={layers[toggle.id]}
            disabled={toggle.id === 'buildings' && buildingsUnavailable}
            onClick={() => onToggle(toggle.id)}
            title={toggle.description}
          >
            <strong>{toggle.label}</strong>
            <span className="helper-text">{toggle.description}</span>
          </button>
        ))}
        {status !== null && (
          <div className="three-d__status">
            <p className="helper-text">
              {counts !== null && `${counts.rfz} RFZs · ${counts.drones} drones · ${counts.traffic} skycells`}
            </p>
            {status.notes.map((note: string) => (
              <p className="helper-text three-d__note" key={note}>
                {note}
              </p>
            ))}
          </div>
        )}
      </div>

      {error !== null && (
        <div className="three-d__error" role="alert">
          <strong>3D scene unavailable.</strong>
          <p>{error}</p>
          <p className="helper-text">The 2D map is unaffected — exit 3D View to continue.</p>
        </div>
      )}
    </section>
  );
}

function sceneTitle(status: SceneStatus): string {
  if (status.buildings === 'hkData') return '3D View — HK 3D Buildings';
  if (status.buildings === 'open3dhk') return '3D View — Open3Dhk';
  if (status.buildings === 'ion') return '3D View — OSM Buildings';
  return '3D View';
}
