import type { GeoPoint } from '../../types/domain';
import { projectToPercent, routeToSvgPoints } from '../../services/mapProjection';

interface RoutePreviewProps {
  route: GeoPoint[];
  label: string;
  /** Accessible summary rendered beside the graphic (the SVG itself is decorative). */
  summary: string;
}

/**
 * Compact 2D route preview for the Flight Plans tab (PRD S112 "map preview with
 * the route"). The SVG is decorative — the accessible content is the labelled
 * group plus the textual summary — so assistive technology never depends on
 * reading a polyline.
 */
export function RoutePreview({ route, label, summary }: RoutePreviewProps): JSX.Element {
  const start = route.length > 0 ? projectToPercent(route[0]) : null;
  const end = route.length > 1 ? projectToPercent(route[route.length - 1]) : start;

  return (
    <div className="route-preview" role="group" aria-label={label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="preview-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="0.2" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="#07101a" />
        <rect width="100" height="100" fill="url(#preview-grid)" />
        <path d="M0,54 C17,47 28,55 43,50 C58,45 68,43 82,49 C90,52 95,50 100,46 L100,100 L0,100 Z" fill="#0b3555" opacity="0.6" />
        {route.length >= 2 && (
          <polyline points={routeToSvgPoints(route)} fill="none" stroke="var(--color-cyan)" strokeWidth="1" strokeDasharray="2 1.2" />
        )}
        {start && <circle cx={start.x} cy={start.y} r="2.2" fill="var(--color-radar)" />}
        {end && <circle cx={end.x} cy={end.y} r="2.2" fill="var(--color-red)" />}
      </svg>
      <p className="helper-text">{summary}</p>
    </div>
  );
}
