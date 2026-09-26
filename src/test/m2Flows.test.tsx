import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';

describe('BUSTARON milestone 2 credits and approvals UI', () => {
  beforeEach(() => {
    useDashboardStore.getState().initialize();
  });

  it('opens the credit wallet and escrows credits when a bid is placed', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /credit wallet/i }));
    // Scope to the panel heading (level 2); the top bar renders an h1 too.
    expect(screen.getByRole('heading', { level: 2, name: /credit wallet/i })).toBeInTheDocument();

    const auctions = within(screen.getByLabelText(/slot auctions/i));
    expect(auctions.getAllByRole('article').length).toBeGreaterThan(0);

    const firstAuction = auctions.getAllByRole('article')[0];
    const controls = within(firstAuction).getByRole('group', { name: /bid controls/i });
    fireEvent.click(within(controls).getByRole('button', { name: /place bid/i }));

    // The top bid line reflects the new 60-credit bid from the first wallet.
    expect(within(firstAuction).getByText(/top bid:/i)).toBeInTheDocument();
  });

  it('lets an admin approve a pending request and reflects the decision', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /admin/i }));
    fireEvent.click(screen.getByRole('button', { name: /approvals queue/i }));

    const queue = within(screen.getByLabelText(/approval requests/i));
    const request = queue.getAllByRole('listitem')[0];
    const decisions = within(request).getByRole('group', { name: /decision controls/i });
    fireEvent.click(within(decisions).getByRole('button', { name: /approve/i }));

    expect(within(request).getByRole('status')).toHaveTextContent(/approved/i);
    expect(screen.getByRole('heading', { level: 2, name: /approvals queue/i })).toBeInTheDocument();
  });

  it('switches the data source to the CAD RFZ pack and back to the mock replay', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /credit wallet/i }));
    const sourceRow = screen.getByRole('group', { name: /data source selection/i });

    fireEvent.click(within(sourceRow).getByRole('button', { name: /CAD RFZ GeoJSON/i }));
    expect(useDashboardStore.getState().zones.length).toBe(284);

    fireEvent.click(within(sourceRow).getByRole('button', { name: /Mock replay/i }));
    expect(useDashboardStore.getState().zones.length).toBe(3);
  });

  it('plans an A* route from the mission panel without breaking the mock shell', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /mission queue/i }));
    fireEvent.click(screen.getByRole('button', { name: /new flight/i }));
    const controls = screen.getByRole('group', { name: /route planner controls/i });

    fireEvent.click(within(controls).getByRole('button', { name: /plan a\* route/i }));

    // Several role="status" regions exist in the draft; assert on state plus text.
    expect(useDashboardStore.getState().plannedRoute).not.toBeNull();
    const statuses = screen.getAllByRole('status');
    expect(statuses.some((element) => /route planned/i.test(element.textContent ?? ''))).toBe(true);
  });
});
