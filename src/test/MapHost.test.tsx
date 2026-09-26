import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function renderHost(): Promise<void> {
  // The provider is resolved from the env at module load, so re-import a fresh
  // module graph after stubbing. No live mapbox-gl instance is required: with a
  // token the host renders the Mapbox container, and the SDK init is skipped
  // when the CDN global is absent (jsdom never fetches the script).
  vi.resetModules();
  const { MapHost } = await import('../components/map/MapHost');
  render(<MapHost />);
}

describe('MapHost provider switch', () => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('selects the mapbox provider when a token is configured', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-public-token');

    await renderHost();

    const host = document.querySelector('[data-map-provider]');
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('data-map-provider', 'mapbox');
    expect(document.body.textContent).toContain('MAPBOX');
  });

  it('falls back to the offline SVG map when no token is configured', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');

    await renderHost();

    const host = document.querySelector('[data-map-provider]');
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute('data-map-provider', 'offline-svg');
    expect(document.body.textContent).toContain('OFFLINE SVG');
  });
});
