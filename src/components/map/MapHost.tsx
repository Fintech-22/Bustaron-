import { useState } from 'react';
import { hasMapbox } from '../../services/mapboxConfig';
import { MapboxMap } from './MapboxMap';
import { TacticalMap } from './TacticalMap';

export type MapProvider = 'mapbox' | 'offline-svg';

const providerLabel: Record<MapProvider, string> = {
  mapbox: 'MAPBOX',
  'offline-svg': 'OFFLINE SVG',
};

/**
 * Chooses the map provider.
 *
 * Default is MAPBOX when a token is configured: the Mapbox path now renders
 * the full tactical overlay (skycells, RFZ zones, weather, routes, drones —
 * PRD FR-OP-V1…V6), so it is the primary landing view and the earlier C6
 * stopgap default is reversed. The offline SVG map remains available via the
 * toggle and is the automatic fallback when no token exists.
 */
export function MapHost(): JSX.Element {
  const [provider, setProvider] = useState<MapProvider>((): MapProvider => (hasMapbox() ? 'mapbox' : 'offline-svg'));

  return (
    <div className="map-host" data-map-provider={provider}>
      {provider === 'mapbox' ? <MapboxMap /> : <TacticalMap />}
      <span className="map-provider-badge" aria-label={`Map provider: ${providerLabel[provider]}`}>
        {providerLabel[provider]}
      </span>
      <div className="map-provider-controls" role="group" aria-label="Map provider selection">
        {(Object.keys(providerLabel) as MapProvider[]).map((candidate: MapProvider): JSX.Element => {
          const active: boolean = candidate === provider;
          const available: boolean = candidate !== 'mapbox' || hasMapbox();
          return (
            <button
              key={candidate}
              type="button"
              className="layer-toggle"
              aria-pressed={active}
              disabled={!available}
              title={
                available
                  ? candidate === 'mapbox'
                    ? 'Mapbox base with the full tactical overlay (skycells, zones, routes, drones).'
                    : 'Offline schematic map. No network required.'
                  : 'Mapbox requires VITE_MAPBOX_TOKEN in .env.local. Without a token the offline SVG map is the only provider.'
              }
              onClick={(): void => setProvider(candidate)}
            >
              <span aria-hidden="true">{active ? '●' : '○'}</span>
              {providerLabel[candidate]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
