import { ALTITUDE_BANDS_M } from '../../services/altitudeBands';
import { useDashboardStore } from '../../store/dashboardStore';

/**
 * The PRD's five altitude-band filter buttons (FR-OP-V6 / S109), shared by the
 * Mapbox and offline-SVG maps. "All bands" disengages the filter; engaging a
 * band filters drone markers to aircraft cruising inside it.
 */
export function AltitudeBandControls(): JSX.Element {
  const altitudeFilterM = useDashboardStore((state) => state.altitudeFilterM);
  const setAltitudeFilter = useDashboardStore((state) => state.setAltitudeFilter);

  return (
    <div className="layer-controls" role="group" aria-label="Altitude band filter">
      <span className="label-text altitude-band-label">Altitude band</span>
      <button
        type="button"
        className="layer-toggle"
        aria-pressed={altitudeFilterM === null}
        onClick={(): void => setAltitudeFilter(null)}
      >
        <span aria-hidden="true">{altitudeFilterM === null ? '●' : '○'}</span>
        All
      </button>
      {ALTITUDE_BANDS_M.map((band) => {
        const active: boolean = altitudeFilterM !== null && altitudeFilterM[0] === band.min && altitudeFilterM[1] === band.max;
        return (
          <button
            key={band.label}
            type="button"
            className="layer-toggle"
            aria-pressed={active}
            onClick={(): void => setAltitudeFilter([band.min, band.max])}
          >
            <span aria-hidden="true">{active ? '●' : '○'}</span>
            {band.label}
          </button>
        );
      })}
    </div>
  );
}
