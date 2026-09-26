import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('BUSTARON milestone 1 shell', () => {
  it('defaults to the operator tactical map with mock layers', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /operator tactical dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /victoria harbour operating picture/i })).toBeInTheDocument();

    const layerControls = within(screen.getByRole('group', { name: /map layer controls/i }));

    expect(layerControls.getByRole('button', { name: /drones/i })).toHaveAttribute('aria-pressed', 'true');
    expect(layerControls.getByRole('button', { name: /routes/i })).toHaveAttribute('aria-pressed', 'true');
    expect(layerControls.getByRole('button', { name: /rfz/i })).toHaveAttribute('aria-pressed', 'true');
    expect(layerControls.getByRole('button', { name: /weather/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets keyboard-accessible controls reach the admin section', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /admin/i }));

    expect(screen.getByRole('heading', { name: /administrative compliance overview/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /compliance and system widgets/i })).toBeInTheDocument();
    expect(screen.getByText(/rfz pack freshness/i)).toBeInTheDocument();
  });

  it('keeps new flight and emergency actions as local UI state', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new flight/i }));
    expect(screen.getByText(/new flight draft is open/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /emergency hold/i }));
    expect(screen.getByRole('button', { name: /emergency active/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
