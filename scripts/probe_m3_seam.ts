/**
 * Headless M3-seam probe: drives the Zustand store's m3-server backend against
 * the live FastAPI server (must be running on 127.0.0.1:8000) and asserts the
 * server-persisted state lands in the store.
 */
import { useDashboardStore } from '../src/store/dashboardStore';
import { submitTx } from '../src/services/m3Backend';

let failures = 0;
function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const s = useDashboardStore.getState();
  s.setBackend('m3-server');

  // Wait for async hydration.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  let st = useDashboardStore.getState();
  assert('backend switched to m3-server', st.backendId === 'm3-server');
  assert('zones loaded through the seam (284 CAD zones)', st.zones.length === 284, `zones=${st.zones.length}`);
  assert('wallets hydrated from the server', st.wallets.length === 3 && st.wallets.every((wallet) => typeof wallet.balanceCredits === 'number'), JSON.stringify(st.wallets.map((w) => w.id)));
  assert('auctions hydrated from the server', st.auctions.length === 2, `auctions=${st.auctions.length}`);

  // Place a bid THROUGH the server chain, then re-hydrate and check the store.
  const walletBefore = st.wallets.find((wallet) => wallet.id === 'wallet-urban')!;
  const tx = await submitTx('AUCTION_BID', { auctionId: 'auction-cbd-evening', walletId: 'wallet-urban', credits: 70 });
  assert('server accepted the bid tx', typeof tx.blockHeight === 'number', JSON.stringify(tx));

  // Re-hydrate through the backend to pick up the server-side escrow.
  useDashboardStore.getState().setBackend('m3-server');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  st = useDashboardStore.getState();
  const walletAfter = st.wallets.find((wallet) => wallet.id === 'wallet-urban')!;
  assert('store reflects the server-side escrow', walletAfter.balanceCredits === walletBefore.balanceCredits - 70 && walletAfter.reservedCredits === walletBefore.reservedCredits + 70, `${walletBefore.balanceCredits}/${walletBefore.reservedCredits} -> ${walletAfter.balanceCredits}/${walletAfter.reservedCredits}`);

  const evening = st.auctions.find((auction) => auction.id === 'auction-cbd-evening')!;
  assert('auction bids grew server-side', evening.bids.length >= 2, `bids=${evening.bids.length}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
