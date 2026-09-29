import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';
import { authAdmin } from './authHelper';

// Static imports (no vi.resetModules) so App and this test share ONE store
// instance — same pattern as m2Flows.test.tsx. MapHost now defaults to the
// offline SVG map regardless of token, so no env stubbing is needed here.

/**
 * Mobile navigation disclosure (TRACE T7 finding 3): below 768px the section
 * list collapses behind a "Menu" toggle so the tactical map is not pushed
 * several screens below the fold. jsdom has no layout engine, so these tests
 * assert the component contract (classes, aria state, store transitions);
 * rendered visibility itself is verified in the live-browser pass.
 */
describe('mobile navigation disclosure', () => {
  beforeEach((): void => {
    act((): void => {
      useDashboardStore.getState().initialize();
      authAdmin();
    });
  });

  it('starts collapsed with a toggle that exposes its state', () => {
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
    const toggle = within(sidebar).getByRole('button', { name: /menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'sidebar-nav-sections');

    // Collapsed on the base (mobile) tier: the collapsed class is applied and
    // the nav landmark stays present for aria-controls to reference.
    const nav = document.getElementById('sidebar-nav-sections');
    expect(nav).not.toBeNull();
    expect(nav).toHaveClass('nav-group--collapsed');
  });

  it('expands and collapses via the toggle', () => {
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
    const toggle = within(sidebar).getByRole('button', { name: /menu/i });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.textContent).toContain('Hide menu');
    expect(document.getElementById('sidebar-nav-sections')).not.toHaveClass('nav-group--collapsed');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('sidebar-nav-sections')).toHaveClass('nav-group--collapsed');
  });

  it('collapses again after navigating to a section', () => {
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /primary navigation/i });
    const toggle = within(sidebar).getByRole('button', { name: /menu/i });
    fireEvent.click(toggle);

    fireEvent.click(within(sidebar).getByRole('button', { name: /mission queue/i }));

    expect(useDashboardStore.getState().activeSection).toBe('missions');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('sidebar-nav-sections')).toHaveClass('nav-group--collapsed');
  });
});
