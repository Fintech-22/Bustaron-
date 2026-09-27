import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let App: () => JSX.Element;

// Pin the offline SVG map so the Live Map tab renders its schematic heading
// regardless of whether a Mapbox token is present in the developer's .env.local.
beforeAll(async (): Promise<void> => {
  vi.stubEnv('VITE_MAPBOX_TOKEN', '');
  vi.resetModules();
  App = (await import('../App')).default;
});

afterAll((): void => {
  vi.unstubAllEnvs();
});

/**
 * PRD S111: the operator sidebar must expose Live Map, Flight Plans, Credit
 * Wallet, ESG Scorecard, Fleet, Analytics and Alerts, and each entry must reach
 * a real tab — not a placeholder.
 */
const tabs: { label: string; heading: RegExp }[] = [
  { label: 'Live Map', heading: /victoria harbour operating picture/i },
  { label: 'Flight Plans', heading: /^flight plans$/i },
  { label: 'Credit Wallet', heading: /^credit wallet$/i },
  { label: 'ESG Scorecard', heading: /^esg scorecard$/i },
  { label: 'Fleet', heading: /^fleet$/i },
  { label: 'Analytics', heading: /^analytics$/i },
  { label: 'Alerts', heading: /^alerts$/i },
  // PRD S111 now names EIGHT operator entries; the 3D View tab carries the HKO
  // weather evidence panel (§5.2) alongside the Cesium scene entry.
  { label: '3D View', heading: /^weather$/i },
];

describe('operator console tabs (PRD S111)', () => {
  it('lists all seven operator entries in the sidebar', () => {
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
    for (const tab of tabs) {
      expect(within(sidebar).getByRole('button', { name: new RegExp(tab.label, 'i') })).toBeInTheDocument();
    }
  });

  it('reaches a real heading on every tab and marks the active entry', () => {
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
    for (const tab of tabs) {
      const button = within(sidebar).getByRole('button', { name: new RegExp(tab.label, 'i') });
      fireEvent.click(button);

      expect(screen.getByRole('heading', { level: 2, name: tab.heading })).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-current', 'page');
    }
  });

  it('keeps the sidebar disclosure working with eight operator entries', () => {
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
    const toggle = within(sidebar).getByRole('button', { name: /menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const nav = document.getElementById('sidebar-nav-sections');
    expect(nav).not.toBeNull();
    // S111: eight operator entries (the two admin entries are hidden).
    expect(nav?.querySelectorAll('button')).toHaveLength(8);
  });
});
