import { useState } from 'react';
import { hasMapbox } from '../../services/mapboxConfig';
import { MapboxMap } from './MapboxMap';
import { TacticalMap } from './TacticalMap';

type MapProvider = 'mapbox' | 'offline-svg';

const providerLabel: Record<MapProvider, string> = {
  mapbox: 'MAPBOX',
  'offline-svg': 'OFFLINE SVG',
};

/**
 * Chooses the map provider once, on first render:
 *   - `mapbox` when a VITE_MAPBOX_TOKEN is configured,
 *   - `offline-svg` (the existing schematic TacticalMap) otherwise.
 */
export function MapHost(): JSX.Element {
  const [provider] = useState<MapProvider>((): MapProvider => (hasMapbox() ? 'mapbox' : 'offline-svg'));

  return (
    <div className="map-host" data-map-provider={provider}>
      {provider === 'mapbox' ? <MapboxMap /> : <TacticalMap />}
      <span className="map-provider-badge" aria-label={`Map provider: ${providerLabel[provider]}`}>
        {providerLabel[provider]}
      </span>
    </div>
  );
}
