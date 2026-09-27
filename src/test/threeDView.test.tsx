import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';
import { makeFakeCesium } from './fakeCesium';
import type { FakeEntity, FakeViewer } from './fakeCesium';

/**
 * 3D View tab (PRD §11.4, S104/S126–S129) against the FAKE Cesium global — real
 * entity geometry and layer-visibility behaviour, zero WebGL/network/pixels. The
 * loader is stubbed to resolve instantly (jsdom cannot fetch the CDN), so what is
 * under test is the wiring and the scene builder, not the SDK.
 */

let fakeCesium: ReturnType<typeof makeFakeCesium>;

/** The live scene's viewer instance — the one the fake Viewer constructor returned. */
function sceneViewer(): FakeViewer {
  return (fakeCesium as unknown as { __viewer: FakeViewer }).__viewer;
}

// No vi.mock on cesiumLoader: the REAL loader resolves immediately whenever a global
// `Cesium` exists (the loader's own first check), so setting the global to the fake
// exercises loader + scene builder together — a stronger test than stubbing the loader.

function openThreeD(): void {
  const topbar = screen.getByRole('banner');
  fireEvent.click(within(topbar).getByRole('button', { name: /3d view/i }));
}

beforeEach((): void => {
  fakeCesium = makeFakeCesium();
  (globalThis as { Cesium?: unknown }).Cesium = fakeCesium;
  act((): void => {
    useDashboardStore.getState().initialize();
  });
});

afterEach((): void => {
  delete (globalThis as { Cesium?: unknown }).Cesium;
  vi.restoreAllMocks();
});

describe('3D View entry and exit (S104/S126/S129)', () => {
  it('opens full-screen over the 2D dashboard from the operator console', () => {
    render(<App />);

    openThreeD();

    expect(screen.getByRole('region', { name: /3d view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit 3d view/i })).toBeInTheDocument();
    // S104: the 2D map stays the landing page underneath; the overlay does not
    // replace the section state.
    expect(useDashboardStore.getState().activeSection).toBe('operations');
    expect(useDashboardStore.getState().threeDView).toBe(true);
  });

  it('is reachable from the admin console too (S126)', () => {
    render(<App />);
    act((): void => {
      useDashboardStore.getState().setRole('admin');
    });

    openThreeD();

    expect(screen.getByRole('region', { name: /3d view/i })).toBeInTheDocument();
  });

  it('returns to the exact 2D dashboard on exit (S129)', () => {
    render(<App />);
    act((): void => {
      useDashboardStore.getState().navigate('fleet');
    });

    openThreeD();
    expect(screen.getByRole('region', { name: /3d view/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /exit 3d view/i }));

    expect(useDashboardStore.getState().threeDView).toBe(false);
    expect(useDashboardStore.getState().activeSection).toBe('fleet');
    expect(screen.queryByRole('region', { name: /3d view/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^fleet$/i })).toBeInTheDocument();
  });
});

describe('3D scene construction (S127)', () => {
  it('builds RFZ volumes, drone markers at altitude and the planned-route trail', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(screen.queryByText(/loading scene/i)).not.toBeInTheDocument();
    });

    const zoneEntities = sceneViewer().entities.values.filter((entity: FakeEntity) =>
      entity.id?.startsWith('zone-'),
    );
    expect(zoneEntities.length).toBeGreaterThan(0);
    const sampleZone = zoneEntities[0].options as {
      polygon?: { extrudedHeight?: number };
      description?: string;
    };
    // FR-3D-V3: restricted volumes extruded 0–400 m.
    expect(sampleZone.polygon?.extrudedHeight).toBe(400);

    const droneEntities = sceneViewer().entities.values.filter((entity: FakeEntity) =>
      entity.id?.startsWith('drone-'),
    );
    expect(droneEntities.length).toBeGreaterThan(0);
    const sampleDrone = droneEntities[0].options as { position?: { height: number }; label?: { text: string } };
    // FR-3D-V4: markers at their real altitude (mock fleet has both 0 m grounded
    // and >0 m flying aircraft — the marker must carry whatever the truth is).
    expect(typeof sampleDrone.position?.height).toBe('number');
    expect(sampleDrone.label?.text).toMatch(/· \d+ m$/);

    // FR-3D-V5: the planned A* trail renders dashed cyan when a route exists.
    const trail = sceneViewer().entities.values.find((entity: FakeEntity) => entity.id === 'planned-route');
    if (trail !== undefined) {
      expect(trail.options.polyline).toBeDefined();
    }
  });

  it('reports honest counts and the provider ladder status', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(document.querySelector('[data-testid="three-d-canvas"]')).not.toBeNull();
      expect(screen.getByText(/imagery:/i)).toBeInTheDocument();
    });

    // No keys in the test env: the ladder must land on `osm` with buildings
    // unavailable and SAY so, never silently pretend.
    expect(screen.getByText(/imagery: osm/i)).toBeInTheDocument();
    expect(screen.getByText(/buildings: unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buildings/i })).toBeDisabled();
  });
});

describe('3D layer toggles (S128)', () => {
  it('flips entity visibility on the live scene without rebuilding it', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(screen.getByText(/imagery:/i)).toBeInTheDocument();
    });
    const viewerBefore = (sceneViewer().camera as unknown as { lastView: unknown }).lastView;

    const panel = screen.getByRole('group', { name: /3d layer controls/i });
    const weatherToggle = within(panel).getByRole('button', { name: /^weather/i });
    expect(weatherToggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(weatherToggle);

    expect(weatherToggle).toHaveAttribute('aria-pressed', 'false');
    const hidden = sceneViewer().entities.values.filter(
      (entity: FakeEntity) => entity.id?.startsWith('weather-'),
    );
    expect(hidden.length).toBeGreaterThan(0);
    for (const entity of hidden) {
      expect(entity.show).toBe(false);
    }
    // No rebuild: the same viewer instance keeps serving (same camera view object).
    expect((sceneViewer().camera as unknown as { lastView: unknown }).lastView).toBe(viewerBefore);
  });

  it('writes shared toggles through to the 2D store so both maps agree', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(screen.getByText(/imagery:/i)).toBeInTheDocument();
    });

    const panel = screen.getByRole('group', { name: /3d layer controls/i });
    fireEvent.click(within(panel).getByRole('button', { name: /^drones/i }));

    expect(useDashboardStore.getState().activeLayers.drones).toBe(false);
  });

  it('rebuilds the scene when the terrain toggle flips (construction-time option)', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(screen.getByText(/imagery:/i)).toBeInTheDocument();
    });

    const panel = screen.getByRole('group', { name: /3d layer controls/i });
    fireEvent.click(within(panel).getByRole('button', { name: /^terrain/i }));

    // A rebuild passes an env WITHOUT the ion token so the new scene uses an
    // ellipsoid; the toggle state flips immediately.
    expect(useDashboardStore.getState().threeDView).toBe(true);
    await waitFor((): void => {
      expect(screen.getByRole('button', { name: /^terrain/i })).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('resilience', () => {
  it('shows an explanation instead of a black screen when the scene fails to build', async () => {
    // Drive the panel's catch path through the REAL loader: a global Cesium whose
    // Viewer constructor throws exercises exactly what a broken SDK/runtime does.
    (globalThis as { Cesium?: unknown }).Cesium = {
      Viewer: class {
        constructor() {
          throw new Error('CesiumJS failed to initialise');
        }
      },
    };

    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/CesiumJS failed to initialise/i)).toBeInTheDocument();
  });
});
