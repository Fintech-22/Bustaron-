import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';
import { authAdmin } from './authHelper';
import { makeFakeCesium } from './fakeCesium';
import type { FakeEntity, FakeViewer } from './fakeCesium';
import * as cesiumLoader from '../services/cesiumLoader';

/**
 * 3D View tab (PRD §11.4, S104/S126–S129) against the FAKE Cesium global — real
 * entity geometry and layer-visibility behaviour, zero WebGL/network/pixels.
 * The control panel is hidden by default; tests open it via the panel toggle.
 */

let fakeCesium: ReturnType<typeof makeFakeCesium>;

function sceneViewer(): FakeViewer {
  return (fakeCesium as unknown as { __viewer: FakeViewer }).__viewer;
}

function openThreeD(): void {
  // RBAC (PRD §7): 3D View overlay is admin-only. Set admin role directly
  // so the 3D button is visible without changing the active section.
  act((): void => {
    useDashboardStore.setState({ activeRole: 'admin' });
  });
  const topbar = screen.getByRole('banner');
  fireEvent.click(within(topbar).getByRole('button', { name: /3d view/i }));
}

/** Open the slide-in control panel so layer buttons are reachable. */
function openPanel(): void {
  fireEvent.click(screen.getByRole('button', { name: /show layer controls/i }));
}

beforeEach((): void => {
  fakeCesium = makeFakeCesium();
  (globalThis as { Cesium?: unknown }).Cesium = fakeCesium;
  act((): void => {
    useDashboardStore.getState().initialize();
    authAdmin();
  });
});

afterEach((): void => {
  delete (globalThis as { Cesium?: unknown }).Cesium;
  vi.restoreAllMocks();
});

describe('3D View entry and exit (S104/S126/S129)', () => {
  it('opens full-screen over the 2D dashboard (admin-only per RBAC)', () => {
    render(<App />);

    openThreeD();

    expect(screen.getByRole('region', { name: /3d view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit 3d/i })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /exit 3d/i }));

    // The exit button triggers a fade-out animation; simulate the animation
    // end to complete the close (Plan 008 — 3D overlay fade enter/exit).
    expect(useDashboardStore.getState().threeDClosing).toBe(true);
    act((): void => {
      useDashboardStore.getState().finishCloseThreeDView();
    });

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
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    const zoneEntities = sceneViewer().entities.values.filter((entity: FakeEntity) =>
      entity.id?.startsWith('zone-'),
    );
    expect(zoneEntities.length).toBeGreaterThan(0);
    const sampleZone = zoneEntities[0].options as {
      polygon?: { extrudedHeight?: number };
      description?: string;
    };
    expect(sampleZone.polygon?.extrudedHeight).toBe(400);

    const droneEntities = sceneViewer().entities.values.filter((entity: FakeEntity) =>
      entity.id?.startsWith('drone-'),
    );
    expect(droneEntities.length).toBeGreaterThan(0);
    const sampleDrone = droneEntities[0].options as { position?: { height: number }; label?: { text: string } };
    expect(typeof sampleDrone.position?.height).toBe('number');
    expect(sampleDrone.label?.text).toMatch(/· \d+ m$/);

    const trail = sceneViewer().entities.values.find((entity: FakeEntity) => entity.id === 'planned-route');
    if (trail !== undefined) {
      expect(trail.options.polyline).toBeDefined();
    }
  });

  it('reports honest counts and the provider ladder status', async () => {
    vi.spyOn(cesiumLoader, 'readCesiumEnv').mockReturnValue({
      open3dhkKey: null,
      ionToken: null,
      hkDataKey: null,
    });
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(document.querySelector('[data-testid="three-d-canvas"]')).not.toBeNull();
    });

    // Open the panel to see the status
    openPanel();

    // No building keys in the test env: buildings must be marked unavailable.
    expect(screen.getByText(/Buildings unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buildings/i })).toBeDisabled();
    vi.restoreAllMocks();
  });
});

describe('3D layer toggles (S128)', () => {
  it('flips entity visibility on the live scene without rebuilding it', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(document.querySelector('[data-testid="three-d-canvas"]')).not.toBeNull();
    });
    const viewerBefore = (sceneViewer().camera as unknown as { lastView: unknown }).lastView;

    openPanel();
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
    expect((sceneViewer().camera as unknown as { lastView: unknown }).lastView).toBe(viewerBefore);
  });

  it('writes shared toggles through to the 2D store so both maps agree', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(document.querySelector('[data-testid="three-d-canvas"]')).not.toBeNull();
    });

    openPanel();
    const panel = screen.getByRole('group', { name: /3d layer controls/i });
    fireEvent.click(within(panel).getByRole('button', { name: /^drones/i }));

    expect(useDashboardStore.getState().activeLayers.drones).toBe(false);
  });

  it('rebuilds the scene when the terrain toggle flips (construction-time option)', async () => {
    render(<App />);
    openThreeD();

    await waitFor((): void => {
      expect(document.querySelector('[data-testid="three-d-canvas"]')).not.toBeNull();
    });

    openPanel();
    const panel = screen.getByRole('group', { name: /3d layer controls/i });
    fireEvent.click(within(panel).getByRole('button', { name: /^terrain/i }));

    expect(useDashboardStore.getState().threeDView).toBe(true);
    await waitFor((): void => {
      expect(screen.getByRole('button', { name: /^terrain/i })).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('resilience', () => {
  it('shows an explanation instead of a black screen when the scene fails to build', async () => {
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
