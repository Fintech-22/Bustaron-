import { buildCreditSeries } from '../../services/creditSeries';
import type { CreditSeries } from '../../services/creditSeries';
import type { CreditLedgerEntry } from '../../types/domain';

interface CreditChartProps {
  ledger: CreditLedgerEntry[];
  walletId: string | null;
  endIso: string;
  label: string;
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 100;
const BASELINE_Y = 50;
const HALF_HEIGHT = 44;
const SLOT_WIDTH = CHART_WIDTH / 30;

/**
 * 30-day credit chart (PRD S113). Bars above the baseline are credits earned
 * that day, bars below are credits spent. The SVG is decorative; the totals are
 * rendered as text so the chart's meaning does not depend on reading pixels.
 */
export function CreditChart({ ledger, walletId, endIso, label }: CreditChartProps): JSX.Element {
  const series: CreditSeries = buildCreditSeries(ledger, walletId, endIso);
  const peak = Math.max(1, series.peak);
  const barWidth = SLOT_WIDTH * 0.62;

  return (
    <div className="credit-chart" role="group" aria-label={label}>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} aria-hidden="true" focusable="false">
        <line x1="0" y1={BASELINE_Y} x2={CHART_WIDTH} y2={BASELINE_Y} stroke="rgba(148,163,184,0.4)" strokeWidth="0.6" />
        {series.days.map((day, index) => {
          const x = index * SLOT_WIDTH + (SLOT_WIDTH - barWidth) / 2;
          const earnedHeight = (day.earned / peak) * HALF_HEIGHT;
          const spentHeight = (day.spent / peak) * HALF_HEIGHT;
          return (
            <g key={day.dateIso}>
              {day.earned > 0 && (
                <rect
                  data-credit-day={day.dateIso}
                  data-credit-kind="earned"
                  data-credit-value={day.earned}
                  x={x}
                  y={BASELINE_Y - earnedHeight}
                  width={barWidth}
                  height={earnedHeight}
                  fill="var(--color-radar)"
                  rx="0.6"
                />
              )}
              {day.spent > 0 && (
                <rect
                  data-credit-day={day.dateIso}
                  data-credit-kind="spent"
                  data-credit-value={day.spent}
                  x={x}
                  y={BASELINE_Y}
                  width={barWidth}
                  height={spentHeight}
                  fill="var(--color-red)"
                  rx="0.6"
                />
              )}
            </g>
          );
        })}
      </svg>
      <p className="helper-text">
        Last 30 days · earned {series.earnedTotal} cr, spent {series.spentTotal} cr, net {series.netTotal >= 0 ? '+' : ''}
        {series.netTotal} cr. Bars above the axis are earnings, below are spends.
      </p>
    </div>
  );
}
