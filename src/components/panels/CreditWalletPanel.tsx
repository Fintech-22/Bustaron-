import { useState } from 'react';
import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { CreditChart } from '../common/CreditChart';
import { quoteRouteCredits } from '../../services/creditsService';
import { buildCreditSeries } from '../../services/creditSeries';
import { listAvailableBackends, useDashboardStore } from '../../store/dashboardStore';
import type { DataBackend } from '../../services/dataBackend';
import type { AuctionStatus, CreditLedgerEntry, CreditWallet, RiskLevel, SlotAuction } from '../../types/domain';

const statusLabelByName: Record<AuctionStatus, string> = {
  open: 'Open',
  awarded: 'Awarded',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

const statusColorByName: Record<AuctionStatus, string> = {
  open: 'var(--color-radar)',
  awarded: 'var(--color-cyan)',
  settled: 'var(--color-subtle)',
  cancelled: 'var(--color-red)',
};

const riskColorByName: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

const BID_PRESETS = [50, 100, 150];

function WalletCard({ wallet }: { wallet: CreditWallet }): JSX.Element {
  return (
    <article className="admin-item" aria-label={`Wallet for ${wallet.operatorName}`}>
      <div className="admin-row">
        <span aria-hidden="true">CRD</span>
        <strong>{wallet.balanceCredits} credits</strong>
      </div>
      <h3 className="panel__title">{wallet.operatorName}</h3>
      <p className="helper-text">{wallet.reservedCredits} credits reserved by open bids and escrow</p>
      <p className="helper-text">Total position {wallet.balanceCredits + wallet.reservedCredits} credits</p>
    </article>
  );
}

function LedgerRow({ entry }: { entry: CreditLedgerEntry }): JSX.Element {
  const deltaLabel = entry.deltaCredits >= 0 ? `+${entry.deltaCredits}` : `${entry.deltaCredits}`;
  const tone: CSSProperties = {
    color: entry.deltaCredits >= 0 ? 'var(--color-radar)' : 'var(--color-red)',
  } as CSSProperties;
  return (
    <li className="status-item">
      <div className="status-row">
        <strong>{entry.reason}</strong>
        <span style={tone}>{deltaLabel} credits</span>
      </div>
      <p className="helper-text">{entry.atIso}</p>
      <p
        className="helper-text mono tx-hash"
        title={entry.txHash ? `Transaction ${entry.txHash}` : 'No transaction hash recorded for this legacy row'}
      >
        {entry.txHash ? `tx ${entry.txHash}` : 'tx hash not recorded'}
      </p>
    </li>
  );
}

function AuctionCard({ auction }: { auction: SlotAuction }): JSX.Element {
  const bidOnAuction = useDashboardStore((state) => state.bidOnAuction);
  const awardTopBid = useDashboardStore((state) => state.awardTopBid);
  const wallets = useDashboardStore((state) => state.wallets);
  const lastError = useDashboardStore((state) => state.lastError);
  const [bidCredits, setBidCredits] = useState(60);
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? '');

  const topBid = auction.bids.reduce<SlotAuction['bids'][number] | null>(
    (best, bid) => (best === null || bid.credits > best.credits ? bid : best),
    null,
  );
  // A bid must beat the reserve and come from a selected wallet.
  const canBid: boolean = walletId !== '' && bidCredits >= auction.reserveCredits + 1;

  return (
    <article className="admin-item" aria-label={`Auction ${auction.slotName}`}>
      <div className="admin-row">
        <span aria-hidden="true">AUC</span>
        <span
          className="badge"
          style={{ '--badge-color': statusColorByName[auction.status], '--badge-border': statusColorByName[auction.status] } as CSSProperties}
        >
          {statusLabelByName[auction.status]}
        </span>
      </div>
      <h3 className="panel__title">{auction.slotName}</h3>
      <p className="helper-text">
        Reserve {auction.reserveCredits} credits · window {auction.windowStartIso.slice(0, 16)} – {auction.windowEndIso.slice(11, 16)} UTC
      </p>
      {topBid ? (
        <p className="helper-text">Top bid: {topBid.bidder} at {topBid.credits} credits ({auction.bids.length} bids)</p>
      ) : (
        <p className="helper-text">No bids yet.</p>
      )}

      {auction.status === 'open' && (
        <div className="bid-controls" role="group" aria-label={`Bid controls for ${auction.slotName}`}>
          <label className="label-text" htmlFor={`bid-amount-${auction.id}`}>
            Bid amount
          </label>
          <input
            id={`bid-amount-${auction.id}`}
            type="number"
            min={auction.reserveCredits + 1}
            step={5}
            value={bidCredits}
            onChange={(event) => setBidCredits(Number(event.target.value))}
          />
          <label className="label-text" htmlFor={`bid-wallet-${auction.id}`}>
            Wallet
          </label>
          <select id={`bid-wallet-${auction.id}`} value={walletId} onChange={(event) => setWalletId(event.target.value)}>
            {wallets.map((wallet: CreditWallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.operatorName} ({wallet.balanceCredits})
              </option>
            ))}
          </select>
          <div className="bid-presets" role="group" aria-label={`Quick bid amounts for ${auction.slotName}`}>
            {BID_PRESETS.map((preset: number) => (
              <button
                key={preset}
                type="button"
                className="layer-toggle"
                aria-pressed={bidCredits === preset}
                onClick={() => setBidCredits(preset)}
              >
                {preset} cr
              </button>
            ))}
          </div>
          <button
            type="button"
            className="control-button"
            disabled={!canBid}
            onClick={() => bidOnAuction(auction.id, walletId, bidCredits)}
          >
            Place bid
          </button>
          <button type="button" className="control-button" disabled={topBid === null} onClick={() => awardTopBid(auction.id)}>
            Award top bid
          </button>
        </div>
      )}
      {lastError && (
        <EmptyState
          compact
          headingLevel={3}
          variant="error"
          title="Auction action failed"
          message={lastError}
        />
      )}
    </article>
  );
}

export function CreditWalletPanel(): JSX.Element {
  const wallets = useDashboardStore((state) => state.wallets);
  const auctions = useDashboardStore((state) => state.auctions);
  const creditLedger = useDashboardStore((state) => state.creditLedger);
  const backendId = useDashboardStore((state) => state.backendId);
  const lastUpdatedIso = useDashboardStore((state) => state.lastUpdatedIso);
  const currentOperatorId = useDashboardStore((state) => state.currentOperatorId);
  const setBackend = useDashboardStore((state) => state.setBackend);
  const backends: DataBackend[] = listAvailableBackends();

  const [scope, setScope] = useState<string>('all');
  const effectiveScope = scope === 'all' ? null : scope;
  const series = buildCreditSeries(creditLedger, effectiveScope, lastUpdatedIso);
  const scopedWallet = wallets.find((wallet: CreditWallet): boolean => wallet.id === currentOperatorId);

  const totalPosition = wallets.reduce((total, wallet) => total + wallet.balanceCredits + wallet.reservedCredits, 0);
  const exampleQuote = quoteRouteCredits(18500, 1);

  return (
    <section className="panel" aria-labelledby="credit-wallet-title">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Operator credits and slot auctions</p>
          <h2 className="panel__title" id="credit-wallet-title">Credit wallet</h2>
        </div>
        <span className="badge" style={{ '--badge-color': 'var(--color-cyan)' } as CSSProperties}>
          {totalPosition} cr fleet-wide
        </span>
      </div>

      <div className="data-source-row" role="group" aria-label="Data source selection">
        <span className="label-text" id="data-source-label">Data source</span>
        {backends.map((backend) => (
          <button
            key={backend.id}
            type="button"
            className="layer-toggle"
            aria-pressed={backendId === backend.id}
            title={backend.usesIngestedGeodata ? 'Backed by ingested CAD RFZ GeoJSON' : 'Offline mock replay'}
            onClick={() => setBackend(backend.id)}
          >
            {backend.label}
          </button>
        ))}
      </div>

      {scopedWallet && (
        <p className="helper-text">
          Signed in as {scopedWallet.operatorName} · balance {scopedWallet.balanceCredits} cr, reserved {scopedWallet.reservedCredits} cr.
        </p>
      )}

      {wallets.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No operator wallets"
          message="Wallet balances appear once an operator is registered with the credit service."
        />
      ) : (
        <div className="admin-grid" aria-label="Operator wallets">
          {wallets.map((wallet: CreditWallet) => (
            <WalletCard key={wallet.id} wallet={wallet} />
          ))}
        </div>
      )}

      {creditLedger.length > 0 && (
        <>
          <h3 className="panel__title spaced-top--lg">Credit movement · 30 days</h3>
          <div className="wallet-scope-row" role="group" aria-label="Wallet scope selection">
            <label className="label-text" htmlFor="wallet-scope">Wallet scope</label>
            <select id="wallet-scope" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">All wallets</option>
              {wallets.map((wallet: CreditWallet) => (
                <option key={wallet.id} value={wallet.id}>{wallet.operatorName}</option>
              ))}
            </select>
          </div>
          <dl className="drone-detail-grid" aria-label="Credit breakdown">
            <div className="detail-card"><dt>Earned</dt><dd>{series.earnedTotal} cr</dd></div>
            <div className="detail-card"><dt>Spent</dt><dd>{series.spentTotal} cr</dd></div>
            <div className="detail-card"><dt>Net</dt><dd>{series.netTotal} cr</dd></div>
          </dl>
          <CreditChart
            ledger={creditLedger}
            walletId={effectiveScope}
            endIso={lastUpdatedIso}
            label={`Credit earned and spent over the last 30 days for ${scope === 'all' ? 'all wallets' : scope}`}
          />
        </>
      )}

      <h3 className="panel__title spaced-top--lg">Open slot auctions</h3>
      {auctions.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No open auctions"
          message="Corridor slot auctions appear here when a corridor owner opens a window."
        />
      ) : (
        <div className="admin-grid" aria-label="Slot auctions">
          {auctions.map((auction: SlotAuction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      )}

      <h3 className="panel__title spaced-top--lg">Recent credit movements</h3>
      {creditLedger.length === 0 ? (
        <EmptyState
          compact
          headingLevel={3}
          title="No credit movements yet"
          message="Bids, awards and approval decisions are appended to the ledger as they happen."
        />
      ) : (
        <ul className="status-list" aria-label="Credit ledger">
          {creditLedger.map((entry: CreditLedgerEntry) => (
            <LedgerRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      <p className="helper-text spaced-top">
        Example quote: 18.5 km route with 1 high-risk segment = {exampleQuote} credits. Escrow is released on award,
        burned on approval, refunded on rejection.
      </p>
      <p className="helper-text" aria-hidden="true" style={{ color: riskColorByName.low }}>
        Auction settlement moves credits to the corridor owner at slot time.
      </p>
    </section>
  );
}
