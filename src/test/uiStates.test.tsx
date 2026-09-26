import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmptyState } from '../components/common/EmptyState';
import { ApprovalsQueuePanel } from '../components/panels/ApprovalsQueuePanel';
import { CreditWalletPanel } from '../components/panels/CreditWalletPanel';
import { MissionPanel } from '../components/panels/MissionPanel';
import { StatusPanel } from '../components/panels/StatusPanel';
import { useDashboardStore } from '../store/dashboardStore';
import type { SlotAuction } from '../types/domain';

const resetStore = (): void => {
  act((): void => {
    useDashboardStore.getState().initialize();
  });
};

beforeEach(resetStore);
afterEach(resetStore);

describe('EmptyState variants', () => {
  it('renders distinct empty, error and loading surfaces with correct roles', () => {
    const empty = render(<EmptyState title="Nothing here" message="No rows yet" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeInTheDocument();
    empty.unmount();

    const error = render(<EmptyState variant="error" title="Action failed" message="Rejected by ledger" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Rejected by ledger');
    error.unmount();

    render(<EmptyState variant="loading" headingLevel={3} title="Loading base map" message="Please wait" />);
    const loading = screen.getByRole('status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveAttribute('data-state-variant', 'loading');
    expect(screen.getByRole('heading', { level: 3, name: 'Loading base map' })).toBeInTheDocument();
  });
});

describe('panel data states', () => {
  it('renders empty states when the active data source has no rows', () => {
    act((): void => {
      useDashboardStore.setState({
        drones: [],
        missions: [],
        approvalRequests: [],
        wallets: [],
        auctions: [],
        creditLedger: [],
      });
    });

    render(
      <>
        <StatusPanel />
        <MissionPanel />
        <ApprovalsQueuePanel />
        <CreditWalletPanel />
      </>,
    );

    expect(screen.getByRole('heading', { level: 3, name: /no aircraft reporting/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /no missions in the queue/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /no approval requests/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /no operator wallets/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /no open auctions/i })).toBeInTheDocument();
  });

  it('surfaces a failed action as an error state', () => {
    act((): void => {
      useDashboardStore.setState({ lastError: 'Bid below reserve: 10 < 31' });
    });

    render(<ApprovalsQueuePanel expanded />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/bid below reserve/i);
    expect(within(alert).getByRole('heading', { level: 3, name: /approval action failed/i })).toBeInTheDocument();
  });
});

describe('interactive disabled states', () => {
  it('disables route planning when origin and destination are the same', () => {
    render(<MissionPanel expanded />);
    fireEvent.click(screen.getByRole('button', { name: /new flight/i }));

    const planButton = screen.getByRole('button', { name: /plan a\* route/i });
    expect(planButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: 'Central pier' } });

    expect(planButton).toBeDisabled();
  });

  it('disables bidding below the auction reserve', () => {
    render(<CreditWalletPanel />);

    const auctions = within(screen.getByLabelText(/slot auctions/i));
    const firstAuction = auctions.getAllByRole('article')[0];
    const controls = within(firstAuction).getByRole('group', { name: /bid controls/i });
    const placeBid = within(controls).getByRole('button', { name: /place bid/i });

    expect(placeBid).toBeEnabled();

    fireEvent.change(within(controls).getByLabelText('Bid amount'), { target: { value: '1' } });

    expect(placeBid).toBeDisabled();
  });

  it('disables awarding an auction that has no bids', () => {
    const bidlessAuction: SlotAuction = {
      id: 'auction-empty',
      slotName: 'Empty corridor window',
      corridorZoneId: 'zone-harbour-corridor',
      windowStartIso: '2026-09-25T01:00:00.000Z',
      windowEndIso: '2026-09-25T04:00:00.000Z',
      reserveCredits: 40,
      status: 'open',
      bids: [],
      winningBidId: null,
    };
    act((): void => {
      useDashboardStore.setState({ auctions: [bidlessAuction] });
    });

    render(<CreditWalletPanel />);

    const auctions = within(screen.getByLabelText(/slot auctions/i));
    const auction = auctions.getAllByRole('article')[0];
    expect(within(auction).getByRole('button', { name: /award top bid/i })).toBeDisabled();
  });
});
