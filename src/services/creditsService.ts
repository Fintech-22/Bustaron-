import type { ApprovalRequest, CreditLedgerEntry, CreditWallet, SlotAuction } from '../types/domain';

export const CREDITS_PER_100KM = 100;
export const CREDITS_PER_HIGH_RISK_SEGMENT = 25;
/** Escrow multiplier applied to high-risk approval requests. */
export const HIGH_RISK_ESCROW_MULTIPLIER = 2;

export interface AuctionAward {
  auctionId: string;
  auction: SlotAuction;
  winningBidId: string;
  winnerWalletId: string;
  winnerWallet: CreditWallet;
  loserWallets: CreditWallet[];
  ledgerEntries: CreditLedgerEntry[];
  /** Wallet state after releasing losing reservations. */
  wallets: CreditWallet[];
  /** Auction list with the awarded auction applied. */
  auctions: SlotAuction[];
}

export interface ApprovalDecisionResult {
  approval: ApprovalRequest;
  approvals: ApprovalRequest[];
  wallets: CreditWallet[];
  ledgerEntries: CreditLedgerEntry[];
}

export class CreditsError extends Error {}

function findWallet(wallets: CreditWallet[], walletId: string): CreditWallet {
  const wallet = wallets.find((entry: CreditWallet): boolean => entry.id === walletId);
  if (!wallet) {
    throw new CreditsError(`Unknown wallet: ${walletId}`);
  }
  return wallet;
}

function sortBidsDescending(auction: SlotAuction): SlotAuction['bids'] {
  return [...auction.bids].sort((a, b) => b.credits - a.credits || a.submittedIso.localeCompare(b.submittedIso));
}

/** Credits quoted for a planned route: distance term plus a high-risk segment surcharge. */
export function quoteRouteCredits(distanceM: number, highRiskSegments: number): number {
  const distanceCredits = Math.ceil((distanceM / 1000 / 100) * CREDITS_PER_100KM);
  return distanceCredits + highRiskSegments * CREDITS_PER_HIGH_RISK_SEGMENT;
}

/** Places a bid, moving credits from balance into reservation. Throws when unaffordable. */
export function placeBid(
  auctions: SlotAuction[],
  wallets: CreditWallet[],
  auctionId: string,
  walletId: string,
  credits: number,
  nowIso: string,
): { auctions: SlotAuction[]; wallets: CreditWallet[] } {
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new CreditsError('Bid must be a positive number of credits');
  }
  const wallet = findWallet(wallets, walletId);
  const auction = auctions.find((entry: SlotAuction): boolean => entry.id === auctionId);
  if (!auction) {
    throw new CreditsError(`Unknown auction: ${auctionId}`);
  }
  if (auction.status !== 'open') {
    throw new CreditsError(`Auction ${auctionId} is not open`);
  }
  if (wallet.balanceCredits < credits) {
    throw new CreditsError(`Insufficient credits: balance ${wallet.balanceCredits}, bid ${credits}`);
  }
  if (credits <= auction.reserveCredits) {
    throw new CreditsError(`Bid must exceed the reserve of ${auction.reserveCredits} credits`);
  }

  const nextWallets = wallets.map((entry: CreditWallet): CreditWallet =>
    entry.id === walletId
      ? { ...entry, balanceCredits: entry.balanceCredits - credits, reservedCredits: entry.reservedCredits + credits }
      : entry,
  );
  const nextAuctions = auctions.map((entry: SlotAuction): SlotAuction =>
    entry.id === auctionId
      ? {
          ...entry,
          bids: [
            ...entry.bids,
            { id: `bid-${entry.bids.length + 1}-${walletId}`, walletId, bidder: wallet.operatorName, credits, submittedIso: nowIso },
          ],
        }
      : entry,
  );
  return { auctions: nextAuctions, wallets: nextWallets };
}

/**
 * Awards an open auction to the highest bid (earliest submission breaks ties),
 * releasing every losing reservation back to balance and transferring the
 * winning reservation to the slot owner.
 */
export function awardAuction(
  auctions: SlotAuction[],
  wallets: CreditWallet[],
  auctionId: string,
  nowIso: string,
): AuctionAward {
  const auction = auctions.find((entry: SlotAuction): boolean => entry.id === auctionId);
  if (!auction) {
    throw new CreditsError(`Unknown auction: ${auctionId}`);
  }
  if (auction.status !== 'open') {
    throw new CreditsError(`Auction ${auctionId} is not open`);
  }
  const ranked = sortBidsDescending(auction);
  if (ranked.length === 0) {
    throw new CreditsError(`Auction ${auctionId} has no bids to award`);
  }
  const winningBid = ranked[0];
  const winnerWalletId = winningBid.walletId;

  const released: CreditWallet[] = [];
  const nextWallets = wallets.map((entry: CreditWallet): CreditWallet => {
    const losingBids = auction.bids.filter(
      (bid) => bid.walletId === entry.id && bid.id !== winningBid.id,
    );
    if (losingBids.length === 0) {
      return entry;
    }
    const releasedCredits = losingBids.reduce((total, bid) => total + bid.credits, 0);
    const releasedWallet: CreditWallet = {
      ...entry,
      balanceCredits: entry.balanceCredits + releasedCredits,
      reservedCredits: entry.reservedCredits - releasedCredits,
    };
    released.push(releasedWallet);
    return releasedWallet;
  });

  // The winning reservation stays escrowed until settleAuction transfers it
  // to the corridor owner; only losing reservations are released here.
  const winnerIndex = nextWallets.findIndex((entry: CreditWallet): boolean => entry.id === winnerWalletId);
  if (winnerIndex < 0) {
    throw new CreditsError(`Unknown winning wallet: ${winnerWalletId}`);
  }
  const winnerWallet: CreditWallet = nextWallets[winnerIndex];

  const ledgerEntries: CreditLedgerEntry[] = auction.bids.map((bid): CreditLedgerEntry => ({
    id: `ledger-${bid.id}`,
    walletId: bid.walletId,
    deltaCredits: bid.id === winningBid.id ? -bid.credits : 0,
    reason: bid.id === winningBid.id ? `Won auction ${auction.slotName}` : `Lost auction ${auction.slotName}`,
    atIso: nowIso,
  }));

  const awardedAuction: SlotAuction = {
    ...auction,
    status: 'awarded',
    winningBidId: winningBid.id,
  };

  const nextAuctions = auctions.map((entry: SlotAuction): SlotAuction => (entry.id === auctionId ? awardedAuction : entry));

  return {
    auctionId,
    auction: awardedAuction,
    winningBidId: winningBid.id,
    winnerWalletId,
    winnerWallet,
    loserWallets: released,
    ledgerEntries,
    wallets: nextWallets,
    auctions: nextAuctions,
  };
}

/** Settles an awarded auction, moving reserved credits to the slot owner. */
export function settleAuction(
  auctions: SlotAuction[],
  wallets: CreditWallet[],
  auctionId: string,
  ownerWalletId: string,
  nowIso: string,
): { auctions: SlotAuction[]; wallets: CreditWallet[]; ledgerEntries: CreditLedgerEntry[] } {
  const auction = auctions.find((entry: SlotAuction): boolean => entry.id === auctionId);
  if (!auction) {
    throw new CreditsError(`Unknown auction: ${auctionId}`);
  }
  if (auction.status !== 'awarded' || !auction.winningBidId) {
    throw new CreditsError(`Auction ${auctionId} is not in the awarded state`);
  }
  const winningBid = auction.bids.find((bid) => bid.id === auction.winningBidId);
  if (!winningBid) {
    throw new CreditsError(`Winning bid ${auction.winningBidId} missing from auction ${auctionId}`);
  }
  const owner = findWallet(wallets, ownerWalletId);
  const credits = winningBid.credits;

  const nextWallets = wallets.map((entry: CreditWallet): CreditWallet => {
    if (entry.id === winningBid.walletId) {
      return { ...entry, reservedCredits: entry.reservedCredits - credits };
    }
    if (entry.id === ownerWalletId) {
      return { ...entry, balanceCredits: entry.balanceCredits + credits };
    }
    return entry;
  });
  void owner;

  const ledgerEntries: CreditLedgerEntry[] = [
    {
      id: `ledger-settle-${auctionId}`,
      walletId: ownerWalletId,
      deltaCredits: credits,
      reason: `Settled auction ${auction.slotName}`,
      atIso: nowIso,
    },
  ];

  const nextAuctions = auctions.map((entry: SlotAuction): SlotAuction =>
    entry.id === auctionId ? { ...entry, status: 'settled' as const } : entry,
  );

  return { auctions: nextAuctions, wallets: nextWallets, ledgerEntries };
}

/** Escrows credits when an operator files a flight approval request. */
export function fileApprovalRequest(
  approvals: ApprovalRequest[],
  wallets: CreditWallet[],
  request: Omit<ApprovalRequest, 'status'>,
): { approvals: ApprovalRequest[]; wallets: CreditWallet[] } {
  const wallet = findWallet(wallets, request.walletId);
  if (wallet.balanceCredits < request.creditsEscrowed) {
    throw new CreditsError(`Insufficient credits to escrow ${request.creditsEscrowed}`);
  }
  const nextWallets = wallets.map((entry: CreditWallet): CreditWallet =>
    entry.id === request.walletId
      ? { ...entry, balanceCredits: entry.balanceCredits - request.creditsEscrowed, reservedCredits: entry.reservedCredits + request.creditsEscrowed }
      : entry,
  );
  const nextApprovals: ApprovalRequest[] = [...approvals, { ...request, status: 'pending' as const }];
  return { approvals: nextApprovals, wallets: nextWallets };
}

/** Approves or rejects a pending request, releasing or burning the escrow accordingly. */
export function decideApproval(
  approvals: ApprovalRequest[],
  wallets: CreditWallet[],
  requestId: string,
  decision: 'approved' | 'rejected',
  nowIso: string,
): ApprovalDecisionResult {
  const approval = approvals.find((entry: ApprovalRequest): boolean => entry.id === requestId);
  if (!approval) {
    throw new CreditsError(`Unknown approval request: ${requestId}`);
  }
  if (approval.status !== 'pending') {
    throw new CreditsError(`Approval ${requestId} has already been decided`);
  }
  const releasedCredits = approval.creditsEscrowed;
  const nextWallets = wallets.map((entry: CreditWallet): CreditWallet =>
    entry.id === approval.walletId
      ? {
          ...entry,
          // Rejected: reservation returns to balance. Approved: burned on flight.
          balanceCredits: decision === 'rejected' ? entry.balanceCredits + releasedCredits : entry.balanceCredits,
          reservedCredits: entry.reservedCredits - releasedCredits,
        }
      : entry,
  );
  const ledgerEntries: CreditLedgerEntry[] = [
    {
      id: `ledger-${requestId}-${decision}`,
      walletId: approval.walletId,
      deltaCredits: decision === 'rejected' ? releasedCredits : 0,
      reason: decision === 'rejected' ? `Refund for rejected ${approval.missionName}` : `Escrow burned for ${approval.missionName}`,
      atIso: nowIso,
    },
  ];
  const nextApprovals = approvals.map((entry: ApprovalRequest): ApprovalRequest =>
    entry.id === requestId ? { ...entry, status: decision } : entry,
  );
  return {
    approval: nextApprovals.find((entry) => entry.id === requestId)!,
    approvals: nextApprovals,
    wallets: nextWallets,
    ledgerEntries,
  };
}
