import type { Drone } from '../types/domain';

/**
 * The PRD's five altitude bands (FR-OP-V6 / S109), in metres. The map's
 * altitude filter snaps to these bands; selecting none shows every aircraft.
 */
export const ALTITUDE_BANDS_M: readonly { label: string; min: number; max: number }[] = [
  { label: '0–80 m', min: 0, max: 80 },
  { label: '80–160 m', min: 80, max: 160 },
  { label: '160–240 m', min: 160, max: 240 },
  { label: '240–320 m', min: 240, max: 320 },
  { label: '320–400 m', min: 320, max: 400 },
] as const;

/** The default engaged band (80–160 m covers the mock cruise altitudes). */
export const DEFAULT_ALTITUDE_BAND_M: readonly [number, number] = [80, 160];

/**
 * True when the drone's current altitude sits inside the band. Band edges are
 * inclusive on both ends so an aircraft cruising exactly at 80/160/240/320 m
 * shows under either adjacent band's filter; the top band closes at 400 m.
 */
export function droneInBand(drone: Drone, band: readonly [number, number] | null): boolean {
  if (band === null) {
    return true;
  }
  const [min, max] = band;
  return drone.altitudeM >= min && drone.altitudeM <= max;
}
