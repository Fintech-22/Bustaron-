import type { Drone, FleetStatus } from '../types/domain';

/**
 * Fleet-tab view model (PRD S114). The telemetry `DroneStatus` (nominal /
 * warning / critical / grounded) is an aircraft-health vocabulary; the fleet tab
 * asks a different question — is the craft idle, flying, or due for maintenance.
 * These pure helpers derive that view so the panel stays presentational.
 */

/** Battery percentage below which a craft is pulled for maintenance. */
export const MAINTENANCE_BATTERY_PCT = 25;

/**
 * Fleet status:
 *  * `maintenance` — a grounded craft, or one whose battery has fallen below the
 *    service threshold (it must be recovered before the next sortie);
 *  * `idle` — airborne-capable but not currently assigned (no active mission);
 *  * `flying` — on an active mission.
 */
export function fleetStatusOf(drone: Drone): FleetStatus {
  if (drone.status === 'grounded' || drone.batteryPct < MAINTENANCE_BATTERY_PCT) {
    return 'maintenance';
  }
  if (drone.missionId === '' || drone.missionId === 'mission-standby') {
    return 'idle';
  }
  return 'flying';
}

export interface FleetStatusMeta {
  label: string;
  color: string;
}

export const FLEET_STATUS_META: Record<FleetStatus, FleetStatusMeta> = {
  idle: { label: 'Idle', color: 'var(--color-subtle)' },
  flying: { label: 'Flying', color: 'var(--color-radar)' },
  maintenance: { label: 'Maintenance', color: 'var(--color-amber)' },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic maintenance-due date (PRD S114). Anchored on the craft's own
 * last-seen timestamp and its remaining battery so the date is stable for a
 * given drone and moves as the craft degrades — no RNG, no wall clock.
 */
export function maintenanceDueIso(drone: Drone): string {
  const seen = new Date(drone.lastSeenIso).getTime();
  const anchor = Number.isFinite(seen) ? seen : 0;
  // A craft at 100% has ~30 service days left; each battery point costs a day.
  const daysRemaining = Math.max(0, Math.round((drone.batteryPct / 100) * 30));
  return new Date(anchor + daysRemaining * DAY_MS).toISOString();
}

/** Human label for a drone's last known location. */
export function lastKnownLocation(drone: Drone): string {
  return `${drone.position.lat.toFixed(3)}, ${drone.position.lng.toFixed(3)}`;
}

/** Formats an ISO timestamp as a `YYYY-MM-DD` UTC date, or an em dash when absent. */
export function formatUtcDate(iso: string): string {
  if (!iso) {
    return '—';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().slice(0, 10);
}
