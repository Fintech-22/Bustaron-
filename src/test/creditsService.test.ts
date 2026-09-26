import { describe, expect, it } from 'vitest';
import {
  CreditsError,
  awardAuction,
  decideApproval,
  fileApprovalRequest,
  placeBid,
  quoteRouteCredits,
  settleAuction,
} from '../services/creditsService';
import type { ApprovalRequest, CreditLedgerEntry, CreditWallet, SlotAuction } from '../types/domain';

function seedWallets(): CreditWallet[] {
  return [
    { id: 'w1', operatorName: 'Alpha', balanceCredits: 500, reservedCredits: 0 },
    { id: 'w2', operatorName: 'Beta', balanceCredits: 300, reservedCredits: 0 },
  ];
}

function seedAuction(): SlotAuction {
  return {
    id: 'a1',
    slotName: 'Test slot',
    corridorZoneId: 'zone-x',
    windowStartIso: '2026-09-27T01:00:00.000Z',
    windowEndIso: '2026-09-27T04:00:00.000Z',
    reserveCredits: 50,
    status: 'open',
    bids: [],
    winningBidId: null,
  };
}

describe('quoteRouteCredits', () => {
  it('scales with distance and high-risk segments', () => {
    expect(quoteRouteCredits(0, 0)).toBe(0);
    expect(quoteRouteCredits(100000, 0)).toBe(100);
    expect(quoteRouteCredits(100001, 0)).toBe(101); // ceiling
    expect(quoteRouteCredits(50000, 2)).toBe(50 + 50);
  });
});

describe('placeBid', () => {
  it('escrows credits and records the bid', () => {
    const auction = seedAuction();
    const wallets = seedWallets();
    const result = placeBid([auction], wallets, 'a1', 'w1', 80, '2026-09-26T00:00:00Z');
    expect(result.wallets[0].balanceCredits).toBe(420);
    expect(result.wallets[0].reservedCredits).toBe(80);
    expect(result.auctions[0].bids).toHaveLength(1);
    expect(result.auctions[0].bids[0].credits).toBe(80);
  });

  it('rejects bids at or below the reserve', () => {
    expect(() => placeBid([seedAuction()], seedWallets(), 'a1', 'w1', 50, 'x')).toThrow(CreditsError);
  });

  it('rejects bids above the wallet balance', () => {
    expect(() => placeBid([seedAuction()], seedWallets(), 'a1', 'w2', 301, 'x')).toThrow(/Insufficient/);
  });

  it('rejects non-positive and non-finite bids', () => {
    expect(() => placeBid([seedAuction()], seedWallets(), 'a1', 'w1', 0, 'x')).toThrow(CreditsError);
    expect(() => placeBid([seedAuction()], seedWallets(), 'a1', 'w1', Number.NaN, 'x')).toThrow(CreditsError);
  });
});

describe('awardAuction', () => {
  it('awards to the top bid and releases losing reservations', () => {
    let auction = seedAuction();
    let wallets = seedWallets();
    const bid1 = placeBid([auction], wallets, 'a1', 'w1', 80, '2026-09-26T00:00:00Z');
    const bid2 = placeBid(bid1.auctions, bid1.wallets, 'a1', 'w2', 120, '2026-09-26T00:01:00Z');
    auction = bid2.auctions[0];
    wallets = bid2.wallets;

    const award = awardAuction([auction], wallets, 'a1', '2026-09-26T00:02:00Z');
    const awarded = award.auction;
    expect(awarded.status).toBe('awarded');
    expect(awarded.winningBidId).toBe(award.winningBidId);

    const winner = award.wallets.find((w) => w.id === 'w2')!;
    expect(winner.reservedCredits).toBe(120); // held until settleAuction
    const loser = award.wallets.find((w) => w.id === 'w1')!;
    expect(loser.balanceCredits).toBe(500); // refunded
    expect(loser.reservedCredits).toBe(0);
    expect(award.ledgerEntries.length).toBe(2);
  });

  it('throws when there are no bids', () => {
    expect(() => awardAuction([seedAuction()], seedWallets(), 'a1', 'x')).toThrow(/no bids/);
  });
});

describe('settleAuction', () => {
  it('transfers the winning reservation to the corridor owner', () => {
    let auction = seedAuction();
    let wallets = seedWallets();
    // w1 bids 80 and wins; w2 acts as the corridor owner at settlement.
    const bid = placeBid([auction], wallets, 'a1', 'w1', 80, '2026-09-26T00:00:00Z');
    const award = awardAuction(bid.auctions, bid.wallets, 'a1', '2026-09-26T00:01:00Z');
    auction = award.auction;
    wallets = award.wallets;

    const settled = settleAuction([auction], wallets, 'a1', 'w2', '2026-09-26T00:03:00Z');
    const winner = settled.wallets.find((w) => w.id === 'w1')!;
    expect(winner.reservedCredits).toBe(0); // reservation consumed
    expect(winner.balanceCredits).toBe(420); // 500 - 80 spent
    const owner = settled.wallets.find((w) => w.id === 'w2')!;
    expect(owner.balanceCredits).toBe(380); // 300 + 80 received
    expect(settled.auctions[0].status).toBe('settled');
    expect(settled.ledgerEntries[0].deltaCredits).toBe(80);
  });

  it('rejects settlement of an auction that is not awarded', () => {
    expect(() => settleAuction([seedAuction()], seedWallets(), 'a1', 'w2', 'x')).toThrow(/not in the awarded state/);
  });
});

describe('approval escrow lifecycle', () => {
  const request: Omit<ApprovalRequest, 'status'> = {
    id: 'req-1',
    missionName: 'Façade survey',
    operator: 'Alpha',
    requestedAtIso: '2026-09-26T00:00:00Z',
    riskLevel: 'high',
    creditsEscrowed: 90,
    walletId: 'w1',
    reason: 'Test request',
  };

  it('files with escrow and approves by burning it', () => {
    const wallets = seedWallets();
    const filed = fileApprovalRequest([], wallets, request);
    expect(filed.wallets[0].balanceCredits).toBe(410);
    expect(filed.wallets[0].reservedCredits).toBe(90);

    const decided = decideApproval(filed.approvals, filed.wallets, 'req-1', 'approved', 'x');
    expect(decided.approval.status).toBe('approved');
    expect(decided.wallets[0].balanceCredits).toBe(410); // burned
    expect(decided.wallets[0].reservedCredits).toBe(0);
    expect(decided.ledgerEntries[0].deltaCredits).toBe(0);
  });

  it('refunds the escrow on rejection', () => {
    const wallets = seedWallets();
    const filed = fileApprovalRequest([], wallets, request);
    const decided = decideApproval(filed.approvals, filed.wallets, 'req-1', 'rejected', 'x');
    expect(decided.wallets[0].balanceCredits).toBe(500);
    expect(decided.ledgerEntries[0].deltaCredits).toBe(90);
  });

  it('rejects double decisions and unknown ids', () => {
    const wallets = seedWallets();
    const filed = fileApprovalRequest([], wallets, request);
    const first = decideApproval(filed.approvals, filed.wallets, 'req-1', 'approved', 'x');
    expect(() => decideApproval(first.approvals, first.wallets, 'req-1', 'rejected', 'x')).toThrow(/already/);
    expect(() => decideApproval(filed.approvals, filed.wallets, 'nope', 'approved', 'x')).toThrow(/Unknown/);
  });

  it('rejects requests the wallet cannot cover', () => {
    const wallets = seedWallets();
    expect(() => fileApprovalRequest([], wallets, { ...request, creditsEscrowed: 1000 })).toThrow(/Insufficient/);
  });
});

describe('ledger typing', () => {
  it('produces CreditLedgerEntry-shaped rows', () => {
    const entry: CreditLedgerEntry = {
      id: 'l1',
      walletId: 'w1',
      deltaCredits: -5,
      reason: 'test',
      atIso: '2026-09-26T00:00:00Z',
    };
    expect(entry.deltaCredits).toBe(-5);
  });
});
