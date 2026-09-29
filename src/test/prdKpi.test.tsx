import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { TacticalMap } from '../components/map/TacticalMap';
import { useDashboardStore } from '../store/dashboardStore';
import { authAdmin } from './authHelper';
import { ALTITUDE_BANDS_M, droneInBand, DEFAULT_ALTITUDE_BAND_M } from '../services/altitudeBands';
import type { Drone } from '../types/domain';

beforeEach((): void => {
  act((): void => {
    useDashboardStore.getState().initialize();
    authAdmin();
  });
});

describe('altitude bands (PRD FR-OP-V6 / S109)', () => {
  it('exposes the five canonical 0-400m bands', () => {
    expect(ALTITUDE_BANDS_M).toHaveLength(5);
    expect(ALTITUDE_BANDS_M[0]).toEqual({ label: '0–80 m', min: 0, max: 80 });
    expect(ALTITUDE_BANDS_M[4]).toEqual({ label: '320–400 m', min: 320, max: 400 });
  });

  it('classifies drones with the 400m top band inclusive', () => {
  const drone = (altitudeM: number): Drone => ({
    id: 'd', callsign: 'T', operatorId: 'wallet-harbour', position: { lat: 22.3, lng: 114.17 }, altitudeM,
    status: 'nominal', batteryPct: 90, missionId: 'm', headingDeg: 0, speedKph: 30, lastSeenIso: 'x',
  });
    expect(droneInBand(drone(390), [320, 400])).toBe(true);
    expect(droneInBand(drone(400), [320, 400])).toBe(true);
    expect(droneInBand(drone(410), [320, 400])).toBe(false);
    expect(droneInBand(drone(80), [0, 80])).toBe(true);
    expect(droneInBand(drone(80), [80, 160])).toBe(true); // edges inclusive
    expect(droneInBand(drone(79), [80, 160])).toBe(false);
    expect(droneInBand(drone(120), null)).toBe(true);
  });

  it('lets the store ceiling reach 400m (defect 1 removed)', () => {
    act((): void => {
      useDashboardStore.getState().setAltitudeBand([320, 400]);
    });
    expect(useDashboardStore.getState().altitudeBandM).toEqual([320, 400]);
  });

  it('renders five band buttons plus All and engages the filter', () => {
    render(<App />);
    const group = screen.getByRole('group', { name: /altitude band filter/i });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(6); // All + five bands

    const band320 = within(group).getByRole('button', { name: /320–400 m/ });
    fireEvent.click(band320);
    expect(useDashboardStore.getState().altitudeFilterM).toEqual([320, 400]);
    expect(band320).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(group).getByRole('button', { name: /All/ }));
    expect(useDashboardStore.getState().altitudeFilterM).toBeNull();
  });

  it('filters map markers to the engaged band', () => {
    act((): void => {
      useDashboardStore.setState({
        drones: [
          { id: 'low', callsign: 'LOW', operatorId: 'wallet-harbour', position: { lat: 22.3, lng: 114.17 }, altitudeM: 40, status: 'nominal', batteryPct: 80, missionId: 'm', headingDeg: 0, speedKph: 30, lastSeenIso: 'x' },
          { id: 'high', callsign: 'HIGH', operatorId: 'wallet-harbour', position: { lat: 22.3, lng: 114.17 }, altitudeM: 350, status: 'nominal', batteryPct: 80, missionId: 'm', headingDeg: 0, speedKph: 30, lastSeenIso: 'x' },
        ],
        altitudeFilterM: [320, 400],
      });
    });

    // Render the SVG provider directly: MapHost picks the provider from the
    // env (this machine has a token), and the filter logic is provider-shared.
    render(<TacticalMap />);

    // SVG fallback provider: markers are buttons in the map group.
    const mapGroup = screen.getByRole('group', { name: /schematic hong kong tactical map/i });
    expect(within(mapGroup).getByRole('button', { name: /HIGH/ })).toBeInTheDocument();
    expect(within(mapGroup).queryByRole('button', { name: /LOW/ })).toBeNull();
  });
});

describe('role-based KPI bars (PRD S110 / S117)', () => {
  it('shows the operator stats bar: Active Drones, Credits Balance, ESG Score, Pending Alerts', () => {
    render(<App />);

    expect(screen.getByText('Credits Balance')).toBeInTheDocument();
    expect(screen.getByText('ESG Score')).toBeInTheDocument();
    expect(screen.getByText('Pending Alerts')).toBeInTheDocument();
    expect(screen.queryByText('Blockchain TPS')).toBeNull();
  });

  it('shows the admin stats bar: Active Drones, Blockchain TPS, City Risk, Pending Approvals', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /admin/i }));

    expect(screen.getByText('Blockchain TPS')).toBeInTheDocument();
    expect(screen.getByText('City Risk Score')).toBeInTheDocument();
    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
    expect(screen.queryByText('ESG Score')).toBeNull();
  });
});

describe('approvals decision reason (PRD S121)', () => {
  it('blocks rejection until a reason is typed, then records it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /admin/i }));
    fireEvent.click(screen.getByRole('button', { name: /approvals queue/i }));

    const queue = within(screen.getByLabelText(/approval requests/i));
    const request = queue.getAllByRole('listitem')[0];
    const decisions = within(request).getByRole('group', { name: /decision controls/i });
    const reject = within(decisions).getByRole('button', { name: /reject/i });

    // Disabled without a reason.
    expect(reject).toBeDisabled();
    fireEvent.change(within(request).getByLabelText(/decision reason/i), { target: { value: 'Harbour traffic above threshold' } });
    expect(reject).toBeEnabled();

    fireEvent.click(reject);

    expect(within(request).getByRole('status')).toHaveTextContent(/Rejected — Harbour traffic above threshold/i);
    // Ledger records the reason too.
    const ledger = useDashboardStore.getState().creditLedger;
    expect(ledger.some((entry) => entry.reason.includes('Harbour traffic above threshold'))).toBe(true);
  });

  it('allows approving without a reason', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /admin/i }));
    fireEvent.click(screen.getByRole('button', { name: /approvals queue/i }));

    const queue = within(screen.getByLabelText(/approval requests/i));
    const request = queue.getAllByRole('listitem')[0];
    fireEvent.click(within(request).getByRole('button', { name: /approve/i }));

    expect(within(request).getByRole('status')).toHaveTextContent(/approved/i);
  });

  it('keeps the default band aligned with the mock cruise window', () => {
    expect(DEFAULT_ALTITUDE_BAND_M).toEqual([80, 160]);
    expect(useDashboardStore.getState().altitudeBandM).toEqual([80, 160]);
  });
});
