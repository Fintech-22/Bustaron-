import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import type { Drone, DroneStatus } from '../../types/domain';

const statusIconByName: Record<DroneStatus, string> = {
  nominal: 'OK',
  warning: 'WATCH',
  critical: 'CRIT',
  grounded: 'GND',
};

const statusLabelByName: Record<DroneStatus, string> = {
  nominal: 'Nominal',
  warning: 'Watch',
  critical: 'Critical',
  grounded: 'Grounded',
};

const statusColorByName: Record<DroneStatus, string> = {
  nominal: 'var(--color-radar)',
  warning: 'var(--color-amber)',
  critical: 'var(--color-red)',
  grounded: 'var(--color-subtle)',
};

export function StatusPanel(): JSX.Element {
  const drones = useDashboardStore((state) => state.drones);
  const selectedDroneId = useDashboardStore((state) => state.selectedDroneId);
  const selectDrone = useDashboardStore((state) => state.selectDrone);
  const selectedDrone: Drone | undefined = drones.find((drone: Drone): boolean => drone.id === selectedDroneId);

  return (
    <section className="panel" aria-labelledby="fleet-status-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Fleet telemetry</p>
          <h2 className="panel__title" id="fleet-status-title">Status panel</h2>
        </div>
        <span className="badge" style={{ '--badge-color': 'var(--color-radar)' } as CSSProperties}>Mock live</span>
      </div>
      {drones.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No aircraft reporting"
          message="No drones are broadcasting telemetry for the active data source. Advance a mock tick or switch data source."
        />
      ) : (
        <ul className="status-list" aria-label="Drone status list">
          {drones.map((drone: Drone): JSX.Element => (
            <li className="status-item" key={drone.id}>
              <div className="status-row">
                <button type="button" className="link-button" onClick={() => selectDrone(drone.id)} aria-pressed={selectedDroneId === drone.id}>
                  {drone.callsign}
                </button>
                <span
                  className="badge"
                  style={{ '--badge-color': statusColorByName[drone.status], '--badge-border': statusColorByName[drone.status] } as CSSProperties}
                >
                  {statusIconByName[drone.status]} {statusLabelByName[drone.status]}
                </span>
              </div>
              <p className="helper-text">Battery {drone.batteryPct}% · Alt {drone.altitudeM} m · {drone.speedKph} kph</p>
            </li>
          ))}
        </ul>
      )}
      {selectedDrone && (
        <dl className="drone-detail-grid spaced-top" aria-label={`Selected drone ${selectedDrone.callsign} details`}>
          <div className="detail-card"><dt>Selected craft</dt><dd>{selectedDrone.callsign}</dd></div>
          <div className="detail-card"><dt>Mission</dt><dd>{selectedDrone.missionId}</dd></div>
          <div className="detail-card"><dt>Position</dt><dd>{selectedDrone.position.lat.toFixed(3)}, {selectedDrone.position.lng.toFixed(3)}</dd></div>
          <div className="detail-card"><dt>Heading</dt><dd>{selectedDrone.headingDeg}°</dd></div>
        </dl>
      )}
    </section>
  );
}
