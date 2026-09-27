import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import { FLEET_STATUS_META, fleetStatusOf, formatUtcDate, lastKnownLocation, maintenanceDueIso } from '../../services/fleet';
import type { Drone } from '../../types/domain';

/**
 * Fleet tab (PRD S114): the operator's drones with fleet status
 * (idle / flying / maintenance), battery percentage, last known location and
 * maintenance due date.
 *
 * Scoping follows PRD §11.3.3: an operator sees their own fleet; an admin sees
 * the whole system.
 */
export function FleetPanel(): JSX.Element {
  const drones = useDashboardStore((state) => state.drones);
  const activeRole = useDashboardStore((state) => state.activeRole);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);

  const visibleDrones = drones.filter(
    (drone: Drone): boolean => activeRole === 'admin' || drone.operatorId === currentOperatorId,
  );
  const maintenanceCount = visibleDrones.filter((drone: Drone): boolean => fleetStatusOf(drone) === 'maintenance').length;

  return (
    <section className="panel" aria-labelledby="fleet-panel-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Aircraft readiness</p>
          <h2 className="panel__title" id="fleet-panel-title">Fleet</h2>
        </div>
        <span className="badge" style={{ '--badge-color': 'var(--color-cyan)' } as CSSProperties}>
          {visibleDrones.length} craft · {maintenanceCount} maintenance
        </span>
      </div>

      {visibleDrones.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No aircraft in scope"
          message="Register a drone with this operator, or switch to Admin to view the whole system fleet."
        />
      ) : (
        <table className="data-table" aria-label="Fleet roster">
          <caption className="helper-text">
            {activeRole === 'admin' ? 'System-wide fleet.' : 'Your fleet. Switch to Admin to view all operators.'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Callsign</th>
              <th scope="col">Status</th>
              <th scope="col">Battery</th>
              <th scope="col">Last known location</th>
              <th scope="col">Maintenance due</th>
            </tr>
          </thead>
          <tbody>
            {visibleDrones.map((drone: Drone) => {
              const status = fleetStatusOf(drone);
              const meta = FLEET_STATUS_META[status];
              return (
                <tr key={drone.id}>
                  <th scope="row">{drone.callsign}</th>
                  <td>
                    <span
                      className="badge"
                      style={{ '--badge-color': meta.color, '--badge-border': meta.color } as CSSProperties}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td>{drone.batteryPct}%</td>
                  <td className="mono">{lastKnownLocation(drone)}</td>
                  <td className="mono">{formatUtcDate(maintenanceDueIso(drone))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
