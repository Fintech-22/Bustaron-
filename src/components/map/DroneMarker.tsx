import type { CSSProperties } from 'react';
import type { Drone, DroneStatus } from '../../types/domain';

interface DroneMarkerProps {
  drone: Drone;
  xPct: number;
  yPct: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

const statusColorByName: Record<DroneStatus, string> = {
  nominal: 'var(--color-radar)',
  warning: 'var(--color-amber)',
  critical: 'var(--color-red)',
  grounded: 'var(--color-subtle)',
};

export function DroneMarker({ drone, xPct, yPct, selected, onSelect }: DroneMarkerProps): JSX.Element {
  return (
    <button
      type="button"
      className="drone-marker"
      aria-label={`Select drone ${drone.callsign}, ${drone.status}, altitude ${drone.altitudeM} meters`}
      aria-pressed={selected}
      onClick={() => onSelect(drone.id)}
      style={{ left: `${xPct}%`, top: `${yPct}%`, '--marker-color': statusColorByName[drone.status] } as CSSProperties}
    >
      <span aria-hidden="true" style={{ transform: `rotate(${drone.headingDeg}deg)` }}>▲</span>
      <span className="drone-marker__callsign">{drone.callsign}</span>
    </button>
  );
}
