import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function renderHost(): Promise<void> {
  // The token is read at module load, so re-import a fresh module graph after
  // stubbing. No live mapbox-gl instance is required: with a token the host
  // still defaults to the offline SVG map (TRACE C6 — the Mapbox path renders
  // no tactical overlay yet), and the SDK init is skipped when the CDN global
  // is absent (jsdom never fetches the script).
  vi.resetModules();
  const { MapHost } = await import('../components/map/MapHost');
  render(<MapHost />);
}

describe('MapHost provider switch', () => {
  beforeEach((): void => {
    // Default to "no token" before each test; individual tests stub their own
    // value. Unstubbed tests therefore exercise the tokenless path.
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');
  });

  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('defaults to the offline SVG map even when a token is configured (C6)', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-public-token');

    await renderHost();

    const host = document.querySelector('[data-map-provider]');
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('data-map-provider', 'offline-svg');
    expect(document.body.textContent).toContain('OFFLINE SVG');
    expect(document.body.textContent).toContain('MAPBOX');
  });

  it('falls back to the offline SVG map when no token is configured', async () => {
    await renderHost();

    const host = document.querySelector('[data-map-provider]');
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('data-map-provider', 'offline-svg');
    expect(document.body.textContent).toContain('OFFLINE SVG');
  });

  it('disables the Mapbox toggle and explains why when no token exists', async () => {
    await renderHost();

    const group = screen.getByRole('group', { name: /map provider selection/i });
    const mapboxButton = within(group).getByRole('button', { name: /MAPBOX/i });
    expect(mapboxButton).toBeDisabled();
    expect(mapboxButton.getAttribute('title')).toMatch(/VITE_MAPBOX_TOKEN/i);

    const svgButton = within(group).getByRole('button', { name: /OFFLINE SVG/i });
    expect(svgButton).toBeEnabled();
    expect(svgButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches providers when a token is configured', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-public-token');

    await renderHost();

    const group = screen.getByRole('group', { name: /map provider selection/i });
    const mapboxButton = within(group).getByRole('button', { name: /MAPBOX/i });
    expect(mapboxButton).toBeEnabled();

    fireEvent.click(mapboxButton);

    expect(document.querySelector('[data-map-provider]')).toHaveAttribute('data-map-provider', 'mapbox');
    // Toggle states flip with the provider.
    expect(mapboxButton).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /OFFLINE SVG/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
