import type { ReactNode } from 'react';

export type EmptyStateVariant = 'empty' | 'error' | 'loading';

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  /** Presentation role: neutral empty, error, or loading. Defaults to `empty`. */
  variant?: EmptyStateVariant;
  /** Inline density for use inside an existing panel (no large centred box). */
  compact?: boolean;
  /** Heading level for the state title. Use 3 when nested inside a level-2 panel. */
  headingLevel?: 2 | 3;
}

const glyphByVariant: Record<EmptyStateVariant, string> = {
  empty: '○',
  error: '!',
  loading: '⋯',
};

/**
 * Single state surface reused for empty, error and loading conditions so the
 * shell never renders blank or ad-hoc placeholders. Error states announce
 * assertively; empty and loading states announce politely.
 */
export function EmptyState({
  title,
  message,
  action,
  variant = 'empty',
  compact = false,
  headingLevel = 2,
}: EmptyStateProps): JSX.Element {
  const isError: boolean = variant === 'error';
  const isLoading: boolean = variant === 'loading';
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const className: string = [
    'empty-state',
    `empty-state--${variant}`,
    compact ? 'empty-state--compact' : '',
  ]
    .filter((token: string): boolean => token.length > 0)
    .join(' ');

  return (
    <section
      className={className}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={isLoading || undefined}
      data-state-variant={variant}
    >
      <div className="empty-state__body">
        <span className="empty-state__glyph" aria-hidden="true">{glyphByVariant[variant]}</span>
        <Heading className="empty-state__title">{title}</Heading>
        <p className="empty-state__message">{message}</p>
        {action !== undefined && <div className="empty-state__action">{action}</div>}
      </div>
    </section>
  );
}
