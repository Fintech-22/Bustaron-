import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function renderHost(): Promise<void> {
  // The token is read at module load, so re-import a fresh module graph after
  // stubbing. jsdom never fetches the CDN script, so the Mapbox branch renders
  // its sdk-missing error state rather than a live map — the assertions target
  // provider selection + toggle state, not canvas contents.
  vi.resetModules();
  const { MapHost } = await import('../components/map/MapHost');
  render(<MapHost />);
}

describe('MapHost provider switch', () => {
  beforeEach((): void => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');
  });

  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('defaults to MAPBOX when a token is configured (overlay is live)', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-public-token');

    await renderHost();

    const host = document.querySelector('[data-map-provider]');
    expect(host).toHaveAttribute('data-map-provider', 'mapbox');
    // The mapbox branch mounts (sdk-missing fallback state in jsdom).
    expect(document.querySelector('[data-mapbox-state]')).not.toBeNull();
  });

  it('falls back to the offline SVG map when no token is configured', async () => {
    await renderHost();

    const host = document.querySelector('[data-map-provider]');
    expect(host).toHaveAttribute('data-map-provider', 'offline-svg');
    expect(document.body.textContent).toContain('OFFLINE SVG');
  });

  it('disables the Mapbox toggle and explains why when no token exists', async () => {
    await renderHost();

    const group = screen.getByRole('group', { name: /map provider selection/i });
    const mapboxButton = within(group).getByRole('button', { name: /MAPBOX/i });
    expect(mapboxButton).toBeDisabled();
    expect(mapboxButton.getAttribute('title')).toMatch(/VITE_MAPBOX_TOKEN/i);
  });

  it('keeps the offline SVG reachable via the toggle when a token exists', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-public-token');

    await renderHost();

    const group = screen.getByRole('group', { name: /map provider selection/i });
    const svgButton = within(group).getByRole('button', { name: /OFFLINE SVG/i });
    expect(svgButton).toBeEnabled();

    fireEvent.click(svgButton);

    expect(document.querySelector('[data-map-provider]')).toHaveAttribute('data-map-provider', 'offline-svg');
    expect(svgButton).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /MAPBOX/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
