import type { AirspaceZone } from '../types/domain';

/**
 * Sandbox classification (PRD §5.3, defect 6). The CAD pack marks sandbox
 * zones in their NAME — "(Low-altitude Economy Regulatory Sandbox)" — while
 * the machine `type` field is "RFZ" for both classes. A zone is sandbox iff
 * its name matches; everything else is a hard restriction.
 */
export const SANDBOX_NAME_PATTERN = /low-altitude economy regulatory sandbox/i;

/** Cost multiplier for waypoints inside a sandbox zone (permissible with authorization). */
export const SANDBOX_COST_FACTOR = 2.5;

/** True when the CAD zone is a permissible-with-authorization sandbox zone. */
export function isSandboxZone(zone: Pick<AirspaceZone, 'name' | 'kind'>): boolean {
  return zone.kind === 'sandbox' || SANDBOX_NAME_PATTERN.test(zone.name);
}
