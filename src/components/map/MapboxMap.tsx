import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../common/EmptyState';
import { MAPBOX_STYLE, MAPBOX_TOKEN } from '../../services/mapboxConfig';
import { buildSkycells, skycellBandColor, skycellsToGeoJson } from '../../services/skycells';
import {
  dronesToGeoJson,
  missionsToGeoJson,
  plannedRouteToGeoJson,
  weatherArrowsToGeoJson,
  weatherToGeoJson,
  zonesToGeoJson,
} from '../../services/zoneGeoJson';
import { useDashboardStore } from '../../store/dashboardStore';
import { MapLayerControls } from './MapLayerControls';
import { AltitudeBandControls } from './AltitudeBandControls';
import { droneInBand } from '../../services/altitudeBands';

const HONG_KONG_CENTER: [number, number] = [114.17, 22.3];
const HONG_KONG_ZOOM = 11.2;

type MapboxStatus = 'idle' | 'ready' | 'sdk-missing' | 'error';

const SOURCE = {
  cells: 'skycells',
  zones: 'rfz-zones',
  weather: 'weather',
  weatherArrows: 'weather-arrows',
  missions: 'missions',
  planned: 'planned-route',
  drones: 'drones',
} as const;

const LAYER = {
  cellFill: 'skycell-fill',
  cellLine: 'skycell-line',
  zoneFill: 'rfz-fill',
  zoneHatch: 'rfz-hatch-fill',
  zoneLine: 'rfz-line',
  weatherFill: 'weather-fill',
  weatherLine: 'weather-line',
  weatherArrow: 'weather-arrow',
  missionLine: 'mission-line',
  plannedLine: 'planned-line',
  droneArrow: 'drone-arrow',
  droneDot: 'drone-dot',
  droneLabel: 'drone-label',
} as const;

/** Zone colour by kind: restricted red, sandbox amber, sensitive purple, heliport blue, corridor cyan. */
const ZONE_COLORS: unknown = ['match', ['get', 'kind'], 'rfz', '#fb7185', 'sandbox', '#fbbf24', 'sensitive', '#c084fc', 'heliport', '#60a5fa', 'corridor', '#38bdf8', '#9fb0c5'];

const STATUS_COLORS: unknown = ['match', ['get', 'status'], 'warning', '#fbbf24', 'critical', '#ef4444', 'grounded', '#9fb0c5', '#4ade80'];

/** Renders a white upward arrow into SDF-ready RGBA pixel data. */
function makeArrowImage(size = 64): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = size / 2;
  const headTop = 3;
  const headBottom = size / 2 - 2;
  const tailBottom = size - 5;
  const halfSpan = size / 2 - 7;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inHead = y >= headTop && y <= headBottom && Math.abs(x - cx) <= ((y - headTop) / (headBottom - headTop)) * halfSpan + 1.5;
      const inTail = y > headBottom && y < tailBottom && Math.abs(x - cx) <= 3.5;
      if (inHead || inTail) {
        const offset = (y * size + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = 255;
      }
    }
  }
  return { width: size, height: size, data };
}

/**
 * Renders the restricted-zone diagonal hatch as an SDF-free RGBA tile for
 * Mapbox `fill-pattern` (PRD FR-OP-V3 / S106). 45° red stripes over a faint red
 * wash so a hatched zone still reads as a zone at low zoom.
 */
function makeHatchImage(size = 16): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const onStripe = (x + y) % 6 < 2;
      data[offset] = 251;
      data[offset + 1] = 113;
      data[offset + 2] = 133;
      data[offset + 3] = onStripe ? 235 : 45;
    }
  }
  return { width: size, height: size, data };
}

function buildOverlay(map: MapboxMapInstance): void {
  // Verification hook: lets headless/live tooling assert rendered overlay
  // features (queryRenderedFeatures) without touching React internals.
  (window as unknown as { __bustaronMap?: MapboxMapInstance }).__bustaronMap = map;
  map.addImage('bustaron-arrow', makeArrowImage(), { pixelRatio: 2 });
  map.addImage('rfz-hatch', makeHatchImage(), { pixelRatio: 1 });

  map.addSource(SOURCE.cells, { type: 'geojson', data: skycellsToGeoJson([]) });
  map.addSource(SOURCE.zones, { type: 'geojson', data: zonesToGeoJson([]) });
  map.addSource(SOURCE.weather, { type: 'geojson', data: weatherToGeoJson([]) });
  map.addSource(SOURCE.weatherArrows, { type: 'geojson', data: weatherArrowsToGeoJson([]) });
  map.addSource(SOURCE.missions, { type: 'geojson', data: missionsToGeoJson([]) });
  map.addSource(SOURCE.planned, { type: 'geojson', data: plannedRouteToGeoJson(null) });
  map.addSource(SOURCE.drones, { type: 'geojson', data: dronesToGeoJson([], '') });

  map.addLayer({
    id: LAYER.cellFill,
    type: 'fill',
    source: SOURCE.cells,
    paint: {
      'fill-color': ['match', ['get', 'band'], 'light', skycellBandColor.light, 'busy', skycellBandColor.busy, 'congested', skycellBandColor.congested, skycellBandColor.clear],
      'fill-opacity': 0.14,
    },
  });
  map.addLayer({
    id: LAYER.cellLine,
    type: 'line',
    source: SOURCE.cells,
    paint: { 'line-color': 'rgba(148,163,184,0.25)', 'line-width': 0.6 },
  });

  map.addLayer({
    id: LAYER.zoneFill,
    type: 'fill',
    source: SOURCE.zones,
    paint: {
      'fill-color': ZONE_COLORS,
      'fill-opacity': ['match', ['get', 'kind'], 'corridor', 0.08, 'heliport', 0.1, 'sandbox', 0.14, 0.18],
    },
  });
  // PRD FR-OP-V3 / S106: restricted (RFZ) zones get the red diagonal hatch on
  // top of the translucent fill; sandbox zones keep the amber outline from
  // `zoneLine`'s kind expression.
  //
  // NOTE — no `beforeId` here on purpose. `Map#addLayer(layer, beforeId)` only
  // accepts an id that ALREADY exists: given an unknown one it fires
  // `Layer with id "..." does not exist on this map.` and returns without adding
  // the layer. Anchoring this to `zoneLine` (which is added a few lines below)
  // therefore dropped the hatch silently and logged an error on every style
  // load. Stacking here comes from insertion order instead, which already yields
  // the intended fill → hatch → line.
  map.addLayer({
    id: LAYER.zoneHatch,
    type: 'fill',
    source: SOURCE.zones,
    filter: ['==', ['get', 'kind'], 'rfz'],
    paint: { 'fill-pattern': 'rfz-hatch', 'fill-opacity': 0.9 },
  });
  map.addLayer({
    id: LAYER.zoneLine,
    type: 'line',
    source: SOURCE.zones,
    paint: { 'line-color': ZONE_COLORS, 'line-width': 1.4, 'line-opacity': 0.9 },
  });

  map.addLayer({
    id: LAYER.weatherFill,
    type: 'fill',
    source: SOURCE.weather,
    paint: {
      'fill-color': ['match', ['get', 'severity'], 'high', '#fb7185', 'critical', '#ef4444', '#fbbf24'],
      'fill-opacity': 0.12,
    },
  });
  map.addLayer({
    id: LAYER.weatherLine,
    type: 'line',
    source: SOURCE.weather,
    paint: { 'line-color': '#fbbf24', 'line-width': 1, 'line-opacity': 0.7 },
  });
  // PRD FR-OP-V5 / S108: one wind arrow per weather cell, rotated to the
  // forecast bearing. Same `beforeId` caveat as the RFZ hatch above — the anchor
  // (`missionLine`) is added below, so stacking relies on insertion order:
  // weather fill → weather line → wind arrows → mission lines.
  map.addLayer({
    id: LAYER.weatherArrow,
    type: 'symbol',
    source: SOURCE.weatherArrows,
    layout: {
      'icon-image': 'bustaron-arrow',
      'icon-size': 0.5,
      'icon-rotate': ['get', 'windDirectionDeg'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
    },
    paint: { 'icon-color': ['match', ['get', 'severity'], 'high', '#fb7185', 'critical', '#ef4444', '#fbbf24'] },
  });

  map.addLayer({
    id: LAYER.missionLine,
    type: 'line',
    source: SOURCE.missions,
    paint: {
      'line-color': ['match', ['get', 'riskLevel'], 'high', '#fb7185', 'critical', '#ef4444', 'medium', '#fbbf24', '#4ade80'],
      'line-width': 2,
    },
  });
  map.addLayer({
    id: LAYER.plannedLine,
    type: 'line',
    source: SOURCE.planned,
    paint: { 'line-color': '#38bdf8', 'line-width': 2.6, 'line-dasharray': [2, 1.4] },
  });

  map.addLayer({
    id: LAYER.droneArrow,
    type: 'symbol',
    source: SOURCE.drones,
    layout: {
      'icon-image': 'bustaron-arrow',
      'icon-size': 0.4,
      'icon-rotate': ['get', 'headingDeg'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
    },
    paint: { 'icon-color': STATUS_COLORS },
  });
  map.addLayer({
    id: LAYER.droneDot,
    type: 'circle',
    source: SOURCE.drones,
    paint: {
      'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 11, 7],
      'circle-color': STATUS_COLORS,
      'circle-stroke-color': ['case', ['boolean', ['get', 'selected'], false], '#38bdf8', '#05080c'],
      'circle-stroke-width': ['case', ['boolean', ['get', 'selected'], false], 3, 1.5],
    },
  });
  map.addLayer({
    id: LAYER.droneLabel,
    type: 'symbol',
    source: SOURCE.drones,
    minzoom: 10,
    layout: {
      'text-field': ['concat', ['get', 'callsign'], '  ', ['get', 'altitudeM'], 'm'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': 11,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
    },
    paint: { 'text-color': '#e5edf7', 'text-halo-color': '#05080c', 'text-halo-width': 1.4 },
  });

  const pickDrone = (event: MapboxMouseEvent): void => {
    const id = event.features?.[0]?.properties?.id;
    if (typeof id === 'string') {
      useDashboardStore.getState().selectDrone(id);
    }
  };
  map.on('click', LAYER.droneDot, pickDrone);
  map.on('click', LAYER.droneArrow, pickDrone);
  map.on('mouseenter', LAYER.droneDot, (): void => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LAYER.droneDot, (): void => {
    map.getCanvas().style.cursor = '';
  });
}

/** Pushes current store state into the overlay sources + layer visibility. */
function pushAll(map: MapboxMapInstance): void {
  const state = useDashboardStore.getState();
  // FR-OP-V6 band filter + §11.3.3 operator scoping (admin sees all).
  const visibleDrones = state.drones
    .filter((drone) => state.activeRole === 'admin' || drone.operatorId === state.currentOperatorId)
    .filter((drone) => droneInBand(drone, state.altitudeFilterM));
  const data: [string, unknown][] = [
    [SOURCE.cells, skycellsToGeoJson(buildSkycells(state.drones, state.missions))],
    [SOURCE.zones, zonesToGeoJson(state.zones)],
    [SOURCE.weather, weatherToGeoJson(state.weatherAlerts)],
    [SOURCE.weatherArrows, weatherArrowsToGeoJson(state.weatherAlerts)],
    [SOURCE.missions, missionsToGeoJson(state.missions)],
    [SOURCE.planned, plannedRouteToGeoJson(state.activeLayers.routes ? state.plannedRoute : null)],
    [SOURCE.drones, dronesToGeoJson(visibleDrones, state.selectedDroneId)],
  ];
  for (const [id, value] of data) {
    map.getSource(id)?.setData(value);
  }
  const visibility: [string, boolean][] = [
    [LAYER.cellFill, state.activeLayers.grid],
    [LAYER.cellLine, state.activeLayers.grid],
    [LAYER.zoneFill, state.activeLayers.restrictedZones],
    [LAYER.zoneHatch, state.activeLayers.restrictedZones],
    [LAYER.zoneLine, state.activeLayers.restrictedZones],
    [LAYER.weatherFill, state.activeLayers.weather],
    [LAYER.weatherLine, state.activeLayers.weather],
    [LAYER.weatherArrow, state.activeLayers.weather],
    [LAYER.missionLine, state.activeLayers.routes],
    [LAYER.droneArrow, state.activeLayers.drones],
    [LAYER.droneDot, state.activeLayers.drones],
    [LAYER.droneLabel, state.activeLayers.drones],
  ];
  for (const [layerId, visible] of visibility) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/**
 * The real Mapbox tactical map (PRD FR-OP-V1…V6, S104–S109): dark HK basemap
 * plus a live overlay — skycell grid by occupancy band, RFZ/sandbox zones,
 * weather cells, mission routes, the planned A* route, and selectable drones
 * with heading arrows and altitude labels. The offline SVG map remains the
 * fallback only when no token is configured.
 */
export function MapboxMap(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapboxStatus>('idle');
  const tick = useDashboardStore((state) => state.tick);
  const activeLayers = useDashboardStore((state) => state.activeLayers);
  const toggleLayer = useDashboardStore((state) => state.toggleLayer);
  // altitudeFilterM is intentionally subscribed here: the band filter changes
  // must re-render MapHost's control row, while the map itself updates via the
  // store subscription inside the init effect (pushAll reads it from state).

  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    if (container === null || MAPBOX_TOKEN === null) {
      return undefined;
    }
    if (typeof mapboxgl === 'undefined') {
      setStatus('sdk-missing');
      return undefined;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    let map: MapboxMapInstance;
    try {
      map = new mapboxgl.Map({
        container,
        style: MAPBOX_STYLE,
        center: HONG_KONG_CENTER,
        zoom: HONG_KONG_ZOOM,
      });
    } catch {
      setStatus('error');
      return undefined;
    }

    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    map.once('load', (): void => {
      if (disposed) return;
      try {
        buildOverlay(map);
        pushAll(map);
        setStatus('ready');

        // Re-push whenever any overlay-relevant store slice changes.
        unsubscribe = useDashboardStore.subscribe((state, prev) => {
        if (
          state.drones !== prev.drones ||
          state.missions !== prev.missions ||
          state.weatherAlerts !== prev.weatherAlerts ||
          state.zones !== prev.zones ||
          state.activeLayers !== prev.activeLayers ||
          state.altitudeFilterM !== prev.altitudeFilterM ||
          state.currentOperatorId !== prev.currentOperatorId ||
          state.activeRole !== prev.activeRole ||
          state.selectedDroneId !== prev.selectedDroneId ||
          state.plannedRoute !== prev.plannedRoute
        ) {
            pushAll(map);
          }
        });
      } catch {
        setStatus('error');
      }
    });

    return (): void => {
      disposed = true;
      unsubscribe?.();
      delete (window as unknown as { __bustaronMap?: MapboxMapInstance }).__bustaronMap;
      map.remove();
    };
  }, []);

  return (
    <section className="map-frame" aria-labelledby="mapbox-map-title">
      <div className="map-header">
        <div>
          <p className="panel__eyebrow">2D Hong Kong tactical map</p>
          <h2 id="mapbox-map-title">Victoria Harbour operating picture</h2>
          <p className="helper-text">
            Live Mapbox overlay: skycell grid, restricted/sandbox zones, weather, mission routes and drones.
          </p>
        </div>
        <button type="button" className="control-button" onClick={tick}>
          <span aria-hidden="true">TICK</span> Advance mock tick
        </button>
      </div>
      <MapLayerControls activeLayers={activeLayers} onToggleLayer={toggleLayer} />
      <AltitudeBandControls />
      <div className="map-canvas">
        {/*
          Labelled group, not role="img": Mapbox injects its own controls and
          attribution links into this container, and role="img" would make them
          unreachable to assistive technology.
        */}
        <div
          ref={containerRef}
          className="mapbox-canvas"
          data-mapbox-state={status}
          role="group"
          aria-label="Interactive Mapbox tactical map of Hong Kong with skycells, restricted zones and drone markers"
        />
        {status === 'idle' && (
          <div className="map-loading">
            <EmptyState
              variant="loading"
              title="Loading tactical overlay"
              message="Requesting Mapbox tiles and ingesting the active RFZ pack."
            />
          </div>
        )}
        {status === 'sdk-missing' && (
          <div className="map-loading">
            <EmptyState
              variant="error"
              title="Base map unavailable"
              message="The Mapbox SDK could not be loaded (offline or blocked)."
            />
          </div>
        )}
        {status === 'error' && (
          <div className="map-loading">
            <EmptyState
              variant="error"
              title="Map failed to initialise"
              message="The Mapbox overlay could not start. Check the console and the configured token."
            />
          </div>
        )}
      </div>
    </section>
  );
}
