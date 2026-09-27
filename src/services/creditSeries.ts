import type { CreditLedgerEntry } from '../types/domain';

/**
 * 30-day credit series for the wallet panel (PRD S113 "30-day chart" plus the
 * earned/spent breakdown). The series is bucketed from the credit ledger's own
 * timestamps, so the chart is a faithful rendering of the audit trail rather
 * than a decorative curve.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreditDayPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  dateIso: string;
  /** Credits credited to the wallet that day (sum of positive deltas). */
  earned: number;
  /** Credits debited that day, as a positive magnitude (sum of |negative deltas|). */
  spent: number;
  /** earned − spent. */
  net: number;
}

export interface CreditSeries {
  days: CreditDayPoint[];
  earnedTotal: number;
  spentTotal: number;
  netTotal: number;
  /** Highest single-day movement, used to scale the chart bars. */
  peak: number;
}

function dayKey(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

/**
 * Buckets the ledger into the last `dayCount` UTC days ending on `endIso`'s day.
 *
 * @param ledger   credit movements, newest last.
 * @param walletId restrict to one wallet; pass null to aggregate every wallet.
 * @param endIso   the anchor timestamp (the store's `lastUpdatedIso`).
 */
export function buildCreditSeries(
  ledger: CreditLedgerEntry[],
  walletId: string | null,
  endIso: string,
  dayCount = 30,
): CreditSeries {
  const scoped = walletId === null ? ledger : ledger.filter((entry: CreditLedgerEntry): boolean => entry.walletId === walletId);
  const endTime = new Date(endIso).getTime();
  const anchor = Number.isFinite(endTime) ? endTime : 0;

  const days: CreditDayPoint[] = [];
  const indexByDay = new Map<string, number>();
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const dateIso = new Date(anchor - offset * DAY_MS).toISOString().slice(0, 10);
    indexByDay.set(dateIso, days.length);
    days.push({ dateIso, earned: 0, spent: 0, net: 0 });
  }

  let earnedTotal = 0;
  let spentTotal = 0;
  for (const entry of scoped) {
    if (entry.deltaCredits > 0) {
      earnedTotal += entry.deltaCredits;
    } else if (entry.deltaCredits < 0) {
      spentTotal += Math.abs(entry.deltaCredits);
    }
    const index = indexByDay.get(dayKey(entry.atIso));
    if (index === undefined) {
      continue;
    }
    const point = days[index];
    if (entry.deltaCredits >= 0) {
      point.earned += entry.deltaCredits;
    } else {
      point.spent += Math.abs(entry.deltaCredits);
    }
  }

  let peak = 0;
  for (const point of days) {
    point.net = point.earned - point.spent;
    peak = Math.max(peak, point.earned, point.spent);
  }

  return { days, earnedTotal, spentTotal, netTotal: earnedTotal - spentTotal, peak };
}
