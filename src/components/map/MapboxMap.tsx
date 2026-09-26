import { useEffect, useRef, useState } from 'react';
import { MAPBOX_STYLE, MAPBOX_TOKEN } from '../../services/mapboxConfig';

const HONG_KONG_CENTER: [number, number] = [114.158, 22.285];
const HONG_KONG_ZOOM = 9.5;

type MapboxStatus = 'idle' | 'ready' | 'sdk-missing';

/**
 * Mapbox base layer for the Hong Kong operating area.
 *
 * Scope for this milestone: the base map only. RFZ polygons, drones, routes and
 * layer toggles remain owned by TacticalMap (the offline SVG map) and are not
 * migrated here yet.
 */
export function MapboxMap(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapboxStatus>('idle');

  useEffect((): (() => void) | undefined => {
    const container = containerRef.current;
    if (container === null || MAPBOX_TOKEN === null) {
      return undefined;
    }
    // The SDK is a CDN global; if the script is blocked or offline, stay inert.
    if (typeof mapboxgl === 'undefined') {
      setStatus('sdk-missing');
      return undefined;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container,
      style: MAPBOX_STYLE,
      center: HONG_KONG_CENTER,
      zoom: HONG_KONG_ZOOM,
    });
    setStatus('ready');

    return (): void => {
      map.remove();
    };
  }, []);

  return (
    <section className="map-frame" aria-labelledby="mapbox-map-title">
      <div className="map-header">
        <div>
          <p className="panel__eyebrow">2D Hong Kong tactical map</p>
          <h2 id="mapbox-map-title">Victoria Harbour operating picture</h2>
          <p className="helper-text">Mapbox base layer. Schematic zones and routes stay on the offline SVG map for this milestone.</p>
        </div>
      </div>
      <div className="map-canvas">
        <div
          ref={containerRef}
          className="mapbox-canvas"
          data-mapbox-state={status}
          role="img"
          aria-label="Mapbox Hong Kong base map centred on Victoria Harbour"
        />
      </div>
    </section>
  );
}
