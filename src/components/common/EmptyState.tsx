import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps): JSX.Element {
  return (
    <section className="empty-state" role="status" aria-live="polite">
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {action}
      </div>
    </section>
  );
}
