import { useState } from 'react';
import { hasMapbox } from '../../services/mapboxConfig';
import { MapboxMap } from './MapboxMap';
import { TacticalMap } from './TacticalMap';

export type MapProvider = 'mapbox' | 'offline-svg';

const providerLabel: Record<MapProvider, string> = {
  mapbox: 'MAPBOX',
  'offline-svg': 'OFFLINE SVG',
};

const providerDescription: Record<MapProvider, string> = {
  mapbox: 'Mapbox raster base layer. Zones, drones and routes stay on the offline schematic map.',
  'offline-svg': 'Offline schematic map with zones, drones, routes and layer toggles. No network required.',
};

/**
 * Chooses the map provider.
 *
 * Default is the OFFLINE SVG tactical map even when a Mapbox token exists
 * (TRACE C6): the Mapbox path renders only a basemap — no RFZ zones, drones,
 * routes or layer toggles — so defaulting to it regressed the PRD's primary
 * landing view. Operators can still switch to the Mapbox base layer via the
 * labelled toggle below the map header.
 */
export function MapHost(): JSX.Element {
  const [provider, setProvider] = useState<MapProvider>((): MapProvider => 'offline-svg');

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
                  ? providerDescription[candidate]
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
      {provider === 'mapbox' && (
        <p className="helper-text map-provider-note" role="status">
          Mapbox base layer active. Tactical overlays (zones, drones, routes) remain on the offline schematic map
          until the overlay migration lands.
        </p>
      )}
      {provider === 'offline-svg' && !hasMapbox() && (
        <p className="helper-text map-provider-note">
          Mapbox base layer unavailable: no VITE_MAPBOX_TOKEN configured. The offline schematic map needs no network.
        </p>
      )}
    </div>
  );
}
