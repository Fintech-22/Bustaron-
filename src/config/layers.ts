import type { LayerDefinition } from '../types/domain';

/**
 * Static presentation config for the map layer toggles.
 *
 * This deliberately does NOT live in `src/data/mockData.ts`. It is UI configuration
 * (which toggles exist and what they are called), not a data source, and keeping it
 * out of the data layer is what lets us state the architectural invariant plainly:
 * **the store never imports a data module** — operational state (drones, missions,
 * zones, wallets, auctions) reaches it only through the `DataBackend` seam.
 *
 * Before this lived here, `dashboardStore.ts` imported `mockData` directly, which
 * made that invariant false on a literal reading.
 */
export const layerDefinitions: LayerDefinition[] = [
  { id: 'drones', label: 'Drones', description: 'Active and grounded fleet markers' },
  { id: 'routes', label: 'Routes', description: 'Mission corridors' },
  { id: 'restrictedZones', label: 'RFZ', description: 'Restricted and sensitive airspace' },
  { id: 'weather', label: 'Weather', description: 'Wind and rain cells' },
  { id: 'grid', label: 'Grid', description: 'Hong Kong tactical reference grid' },
];
