import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDashboardStore } from '../store/dashboardStore';
import { authAdmin } from './authHelper';
import type { Alert } from '../types/domain';

beforeEach((): void => {
  useDashboardStore.getState().initialize();
  authAdmin();
});

/**
 * PRD S115: the Alerts tab is a real-time feed with severity, type, source
 * drone and timestamp, and an acknowledge button that actually changes state.
 */
describe('Alerts feed (PRD S115)', () => {
  it('renders a severity-coded feed and acknowledges an alert', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /alerts/i }));

    expect(screen.getByRole('heading', { level: 2, name: /^alerts$/i })).toBeInTheDocument();

    const feed = screen.getByRole('list', { name: /alert feed/i });
    const items = within(feed).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);

    // Severity is exposed on the item so the styling and the DOM agree.
    expect(items[0]).toHaveAttribute('data-severity', 'critical');
    expect(within(items[0]).getByText('critical')).toBeInTheDocument();

    const alertId: string = items[0].getAttribute('data-alert-id') ?? '';
    expect(alertId.length).toBeGreaterThan(0);

    const acknowledge = within(items[0]).getByRole('button', { name: /acknowledge/i });
    expect(acknowledge).toBeEnabled();
    expect(acknowledge).toHaveAttribute('aria-pressed', 'false');
    expect(within(items[0]).getByRole('status')).toHaveTextContent(/awaiting acknowledgement/i);

    fireEvent.click(acknowledge);

    expect(acknowledge).toBeDisabled();
    expect(acknowledge).toHaveAttribute('aria-pressed', 'true');
    expect(within(items[0]).getByRole('status')).toHaveTextContent(/acknowledged/i);

    const stored: Alert | undefined = useDashboardStore.getState().alerts.find((alert: Alert): boolean => alert.id === alertId);
    expect(stored?.acknowledged).toBe(true);
  });

  it('acknowledges every outstanding alert at once', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /alerts/i }));

    const acknowledgeAll = screen.getByRole('button', { name: /acknowledge all/i });
    expect(acknowledgeAll).toBeEnabled();
    fireEvent.click(acknowledgeAll);

    expect(acknowledgeAll).toBeDisabled();
    expect(useDashboardStore.getState().alerts.every((alert: Alert): boolean => alert.acknowledged)).toBe(true);
  });

  it('keeps an acknowledgement across a mock tick', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /alerts/i }));

    const feed = screen.getByRole('list', { name: /alert feed/i });
    const first = within(feed).getAllByRole('listitem')[0];
    const alertId: string = first.getAttribute('data-alert-id') ?? '';
    fireEvent.click(within(first).getByRole('button', { name: /acknowledge/i }));

    act((): void => {
      useDashboardStore.getState().tick();
    });

    const stored = useDashboardStore.getState().alerts.find((alert: Alert): boolean => alert.id === alertId);
    expect(stored?.acknowledged).toBe(true);
  });
});
