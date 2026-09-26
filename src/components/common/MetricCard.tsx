import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  trend: string;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
  icon?: ReactNode;
}

const toneColorByName: Record<NonNullable<MetricCardProps['tone']>, string> = {
  neutral: 'var(--color-cyan)',
  good: 'var(--color-radar)',
  warning: 'var(--color-amber)',
  critical: 'var(--color-red)',
};

export function MetricCard({ label, value, trend, tone = 'neutral', icon }: MetricCardProps): JSX.Element {
  return (
    <article className="metric-card" aria-label={`${label}: ${value}`}>
      <div className="status-row">
        <p className="metric-card__label">{label}</p>
        <span aria-hidden="true" style={{ color: toneColorByName[tone] }}>
          {icon}
        </span>
      </div>
      <p className="metric-card__value" style={{ color: toneColorByName[tone] }}>
        {value}
      </p>
      <p className="metric-card__trend">{trend}</p>
    </article>
  );
}
