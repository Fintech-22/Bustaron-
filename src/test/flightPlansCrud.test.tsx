import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';

beforeEach((): void => {
  useDashboardStore.getState().initialize();
});

/**
 * PRD S112: the Flight Plans tab supports full CRUD — list, create, view, update
 * and delete — plus a route preview, a risk analysis and approval status.
 */
describe('Flight Plans CRUD (PRD S112)', () => {
  it('creates, updates and deletes a flight plan', () => {
    render(<App />);

    // Reach the tab through the sidebar.
    fireEvent.click(screen.getByRole('button', { name: /flight plans/i }));
    expect(screen.getByRole('heading', { level: 2, name: /^flight plans$/i })).toBeInTheDocument();

    const list = (): HTMLElement => screen.getByRole('list', { name: /^flight plans$/i });
    const initialCount = within(list()).getAllByRole('listitem').length;
    expect(initialCount).toBeGreaterThan(0);

    // --- CREATE: plan an A* route, name it and save it.
    fireEvent.click(screen.getByRole('button', { name: /new flight/i }));
    const controls = screen.getByRole('group', { name: /route planner controls/i });
    fireEvent.click(within(controls).getByRole('button', { name: /plan a\* route/i }));
    fireEvent.change(screen.getByLabelText(/flight plan name/i), { target: { value: 'Kowloon corridor survey' } });
    fireEvent.click(screen.getByRole('button', { name: /save flight plan/i }));

    expect(within(list()).getAllByRole('listitem')).toHaveLength(initialCount + 1);
    expect(within(list()).getByText('Kowloon corridor survey')).toBeInTheDocument();
    // The newly created plan is selected, so its risk analysis renders.
    expect(screen.getByText(/plan detail · kowloon corridor survey/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/risk analysis/i)).toBeInTheDocument();

    // --- UPDATE: rename the plan and change its status.
    const created = within(list()).getByText('Kowloon corridor survey').closest('li');
    expect(created).not.toBeNull();
    fireEvent.click(within(created as HTMLElement).getByRole('button', { name: /^edit$/i }));

    fireEvent.change(screen.getByLabelText(/edit name/i), { target: { value: 'Renamed corridor survey' } });
    fireEvent.change(screen.getByLabelText(/edit status/i), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(within(list()).getByText('Renamed corridor survey')).toBeInTheDocument();
    expect(within(list()).queryByText('Kowloon corridor survey')).toBeNull();

    // --- DELETE: remove the plan again.
    const renamed = within(list()).getByText('Renamed corridor survey').closest('li');
    expect(renamed).not.toBeNull();
    expect(within(renamed as HTMLElement).getByText(/· Active ·/)).toBeInTheDocument();
    fireEvent.click(within(renamed as HTMLElement).getByRole('button', { name: /delete renamed corridor survey/i }));

    expect(within(list()).queryByText('Renamed corridor survey')).toBeNull();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(initialCount);
  });

  it('shows the linked approval status for a seeded plan', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /flight plans/i }));

    // The mock mission "Victoria Harbour inspection" has no filed request…
    expect(screen.getByText(/Not filed/)).toBeInTheDocument();
  });
});
