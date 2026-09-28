import { afterEach, describe, expect, it, vi } from 'vitest';

interface MapboxConfigModule {
  MAPBOX_TOKEN: string | null;
  MAPBOX_STYLE: string;
  hasMapbox: () => boolean;
}

async function loadConfig(): Promise<MapboxConfigModule> {
  vi.resetModules();
  return import('../services/mapboxConfig');
}

describe('mapboxConfig', () => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('exposes the token and reports Mapbox available when the env value is set', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test-public-token');

    const config = await loadConfig();

    expect(config.MAPBOX_TOKEN).toBe('pk.test-public-token');
    expect(config.hasMapbox()).toBe(true);
  });

  it('reports Mapbox unavailable when the env value is absent', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', undefined);

    const config = await loadConfig();

    expect(config.MAPBOX_TOKEN).toBeNull();
    expect(config.hasMapbox()).toBe(false);
  });

  it('treats an empty or whitespace-only token as absent', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '   ');

    const config = await loadConfig();

    expect(config.MAPBOX_TOKEN).toBeNull();
    expect(config.hasMapbox()).toBe(false);
  });

  it('points at the light streets mapbox style', async () => {
    const config = await loadConfig();

    expect(config.MAPBOX_STYLE).toBe('mapbox://styles/mapbox/streets-v12');
  });
});
