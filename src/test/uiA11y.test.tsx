import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let App: () => JSX.Element;

// Pin the offline SVG map so the schematic drone markers are rendered. The map
// provider is resolved from VITE_MAPBOX_TOKEN when the module graph loads.
beforeAll(async (): Promise<void> => {
  vi.stubEnv('VITE_MAPBOX_TOKEN', '');
  vi.resetModules();
  App = (await import('../App')).default;
});

afterAll((): void => {
  vi.unstubAllEnvs();
});

function headingLevels(): number[] {
  return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(
    (element: Element): number => Number(element.tagName.slice(1)),
  );
}

describe('tactical map accessibility', () => {
  it('exposes the map as a labelled group instead of a role="img" trap', () => {
    render(<App />);

    const canvas = document.querySelector('.map-canvas');
    expect(canvas).not.toBeNull();
    // role="img" makes all descendants presentational, hiding the drone buttons.
    expect(canvas).not.toHaveAttribute('role', 'img');
    expect(canvas).toHaveAttribute('role', 'group');
    expect(canvas).toHaveAccessibleName(/schematic hong kong tactical map/i);
  });

  it('keeps graphic semantics on the SVG itself', () => {
    render(<App />);

    const graphics = screen.getAllByRole('img');
    expect(graphics).toHaveLength(1);
    expect(graphics[0].tagName.toLowerCase()).toBe('svg');
    expect(graphics[0]).toHaveAccessibleName(/schematic hong kong geography/i);
  });

  it('makes every drone marker reachable by role, name and keyboard focus', () => {
    render(<App />);

    const markers = screen.getAllByRole('button', { name: /select drone/i });
    expect(markers.length).toBeGreaterThan(1);

    const target = markers[1];
    expect(target.tagName).toBe('BUTTON');
    expect(target).toHaveAttribute('aria-pressed');
    expect(target).toBeVisible();

    target.focus();
    expect(document.activeElement).toBe(target);

    fireEvent.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not skip heading levels and has exactly one page title', () => {
    render(<App />);

    const levels = headingLevels();
    expect(levels.filter((level: number): boolean => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
    }
  });
});
