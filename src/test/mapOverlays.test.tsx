import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TacticalMap } from '../components/map/TacticalMap';
import { useDashboardStore } from '../store/dashboardStore';
import type { AirspaceZone } from '../types/domain';

const restricted: AirspaceZone = {
  id: 'zone-test-rfz',
  name: 'Test restricted zone',
  kind: 'rfz',
  riskLevel: 'high',
  restriction: 'No entry',
  polygon: [
    { lat: 22.31, lng: 114.16 },
    { lat: 22.32, lng: 114.17 },
    { lat: 22.31, lng: 114.18 },
    { lat: 22.3, lng: 114.17 },
  ],
};

const sandbox: AirspaceZone = {
  id: 'zone-test-sandbox',
  name: 'Test (Low-altitude Economy Regulatory Sandbox)',
  kind: 'sandbox',
  riskLevel: 'medium',
  restriction: 'Authorized operations only',
  polygon: [
    { lat: 22.34, lng: 114.19 },
    { lat: 22.35, lng: 114.2 },
    { lat: 22.34, lng: 114.21 },
    { lat: 22.33, lng: 114.2 },
  ],
};

beforeEach((): void => {
  act((): void => {
    useDashboardStore.getState().initialize();
  });
});

describe('2D map RFZ rendering (PRD FR-OP-V3 / S106)', () => {
  it('renders restricted zones with red outlines and diagonal hatching', () => {
    act((): void => {
      useDashboardStore.setState({ zones: [restricted, sandbox] });
    });
    render(<TacticalMap />);

    const rfz = document.querySelector('polygon[data-zone-kind="rfz"]');
    expect(rfz).not.toBeNull();
    expect(rfz).toHaveAttribute('fill', 'url(#rfz-hatch)');
    expect(rfz).toHaveAttribute('stroke', 'var(--color-red)');

    const hatch = document.getElementById('rfz-hatch');
    expect(hatch).not.toBeNull();
    expect(hatch?.tagName.toLowerCase()).toBe('pattern');
    // The hatch must be diagonal, not a flat tint.
    expect(hatch).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(hatch?.querySelector('line')).not.toBeNull();
  });

  it('renders sandbox zones as amber outlines', () => {
    act((): void => {
      useDashboardStore.setState({ zones: [restricted, sandbox] });
    });
    render(<TacticalMap />);

    const sb = document.querySelector('polygon[data-zone-kind="sandbox"]');
    expect(sb).not.toBeNull();
    expect(sb).toHaveAttribute('stroke', 'var(--color-amber)');
    expect(sb).not.toHaveAttribute('fill', 'url(#rfz-hatch)');
  });
});

describe('2D map weather overlay (PRD FR-OP-V5 / S108)', () => {
  it('renders a rotated wind arrow and a precipitation zone per weather cell', () => {
    render(<TacticalMap />);

    const arrows = document.querySelectorAll('[data-weather-arrow="wind"]');
    expect(arrows).toHaveLength(2);
    expect(arrows[0].getAttribute('transform')).toMatch(/rotate\(68\)/);
    expect(arrows[1].getAttribute('transform')).toMatch(/rotate\(205\)/);

    const precipitation = document.querySelectorAll('[data-weather-zone]');
    expect(precipitation).toHaveLength(2);
    expect(precipitation[0]).toHaveAttribute('fill', 'url(#precip-hatch)');
    expect(document.getElementById('precip-hatch')).not.toBeNull();
  });

  it('hides the weather overlay when the layer is toggled off', () => {
    act((): void => {
      useDashboardStore.getState().toggleLayer('weather');
    });
    render(<TacticalMap />);

    expect(document.querySelectorAll('[data-weather-arrow="wind"]')).toHaveLength(0);
    expect(screen.getByRole('group', { name: /schematic hong kong tactical map/i })).toBeInTheDocument();
  });
});
