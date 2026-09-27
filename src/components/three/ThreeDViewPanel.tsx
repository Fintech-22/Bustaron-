import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScene, type SceneController, type SceneCounts, type SceneStatus, type ThreeDLayerId } from './cesiumScene';
import { loadCesium, readCesiumEnv } from '../../services/cesiumLoader';
import { buildSkycells } from '../../services/skycells';
import { useDashboardStore } from '../../store/dashboardStore';
import type { Drone, LayerId } from '../../types/domain';

/**
 * 3D View tab (PRD §11.4, S126–S129).
 *
 * Full-screen CesiumJS scene rendered as an OVERLAY over whichever 2D section is
 * active (S127) — the 2D dashboard stays mounted underneath, so the single Exit
 * button (S129) hands back exactly the dashboard that was left, for both roles.
 *
 * Layer toggles cover S128's six plus drones/routes; the ones the 2D map also has
 * write through to the SAME store flags, so the two maps never disagree. `terrain`
 * is a construction-time option in Cesium (the provider is handed to the Viewer),
 * so flipping it rebuilds the scene; every other toggle paints the live scene.
 *
 * Loading is lazy: the ~3 MB SDK is fetched only when this overlay mounts, and a
 * load or build failure renders an explanation instead of a silent black screen.
 */

interface ThreeDLayerToggle {
  id: ThreeDLayerId;
  label: string;
  description: string;
}

const TOGGLES: ThreeDLayerToggle[] = [
  { id: 'buildings', label: 'Buildings', description: 'Open3Dhk / Cesium OSM 3D city model' },
  { id: 'terrain', label: 'Terrain', description: 'World Terrain (rebuilds the scene)' },
  { id: 'restrictedZones', label: 'RFZs', description: 'Extruded airspace volumes, 0–400 m' },
  { id: 'trails', label: 'Trails', description: 'Planned A* route, dashed' },
  { id: 'drones', label: 'Drones', description: 'Markers at their real altitude' },
  { id: 'routes', label: 'Mission routes', description: 'Corridor polylines' },
  { id: 'weather', label: 'Weather', description: 'Rain cells + cell wind speed' },
  { id: 'grid', label: 'Traffic heatmap', description: 'Skycell occupancy volumes' },
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

  const env = useMemo(() => readCesiumEnv(), []);
  // PRD §11.3.3 fleet scoping, identical to the 2D map: operators see their own
  // drones, admin sees everyone.
  const drones = useMemo(
    () =>
      activeRole === 'admin' || currentOperatorId === null
        ? dronesAll
        : dronesAll.filter((drone: Drone): boolean => drone.operatorId === currentOperatorId),
    [activeRole, currentOperatorId, dronesAll],
  );
  const skycells = useMemo(() => buildSkycells(drones, missions), [drones, missions]);
  const layers = useMemo<Record<ThreeDLayerId, boolean>>(
    () => ({ ...storeLayers, ...local3d }),
    [storeLayers, local3d],
  );

  // Build the scene once per terrain choice + data identity. Layer flags are NOT
  // construction inputs — they are painted on through setLayer below, so a toggle
  // never throws away the camera.
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
        // MUST precede buildScene: the scene builder reads the Cesium GLOBAL, which
        // only exists once the SDK has loaded.
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
    // `layers` and `env` are read deliberately: env never changes for the page's
    // lifetime, and layer flips are painted by the effect below instead of forcing a
    // rebuild. Everything else on this line is a genuine scene input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainOn, zones, drones, missions, weatherAlerts, skycells, plannedRoute]);

  // Paint layer changes onto the live scene (no rebuild, camera preserved).
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
    <section className="three-d" aria-label="3D View">
      <div className="three-d__bar">
        <div>
          <p className="three-d__eyebrow">Situational awareness</p>
          <h2 className="three-d__title">
            {status === null ? '3D View — loading scene…' : sceneTitle(status)}
          </h2>
        </div>
        {/* PRD S129: the single exit back to the 2D dashboard. */}
        <button type="button" className="control-button three-d__exit" onClick={closeThreeDView}>
          Exit 3D View
        </button>
      </div>

      <div className="three-d__canvas" ref={containerRef} data-testid="three-d-canvas" />

      {error !== null && (
        <div className="three-d__error" role="alert">
          <strong>3D scene unavailable.</strong>
          <p>{error}</p>
          <p className="helper-text">The 2D map is unaffected — exit 3D View to continue operating.</p>
        </div>
      )}

      <div className="three-d__panel" role="group" aria-label="3D layer controls">
        <p className="nav-group__label">Layers</p>
        {TOGGLES.map((toggle) => (
          <button
            key={toggle.id}
            type="button"
            className="layer-button"
            aria-pressed={layers[toggle.id]}
            disabled={toggle.id === 'buildings' && buildingsUnavailable}
            onClick={() => onToggle(toggle.id)}
            title={
              toggle.id === 'buildings' && buildingsUnavailable
                ? 'No city-model key configured (VITE_OPEN3DHK_KEY / VITE_CESIUM_ION_TOKEN)'
                : toggle.description
            }
          >
            <strong>{toggle.label}</strong>
            <span className="helper-text">{toggle.description}</span>
          </button>
        ))}
        {status !== null && (
          <div className="three-d__status">
            <p className="helper-text">
              imagery: {status.provider} · buildings: {status.buildings} · terrain: {status.terrain}
            </p>
            {counts !== null && (
              <p className="helper-text">
                {counts.rfz} volumes · {counts.drones} drones · {counts.weather} weather items ·{' '}
                {counts.traffic} skycells
              </p>
            )}
            {status.notes.map((note: string) => (
              <p className="helper-text three-d__note" key={note}>
                {note}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function sceneTitle(status: SceneStatus): string {
  if (status.provider === 'open3dhk') {
    return '3D View — Open3Dhk Hong Kong tiles';
  }
  if (status.provider === 'ion') {
    return '3D View — Cesium OSM Buildings + World Terrain';
  }
  return '3D View — OpenStreetMap imagery (city-model keys not configured)';
}
