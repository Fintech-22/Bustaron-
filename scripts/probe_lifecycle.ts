/**
 * Headless end-to-end lifecycle probe (bun, no DOM).
 *
 * Drives the real store through the full operator/admin lifecycle and asserts
 * every state transition with hard failures (non-zero exit):
 *   1. init (mock) -> plan route (mock) -> switch CAD -> plan + refusal checks
 *   2. credits: place bid -> escrow check -> award -> settlement transfer
 *   3. approvals: pending -> reject (refund) and approve (burn), ledger rows
 *   4. seam integrity (DataBackend registry)
 *
 * Seed arithmetic (src/data/mockData.ts): wallets harbour 480/40, urban 260/80,
 * cargo 640/160 — reserved mirrors the open bids (harbour 40 on vh-morning,
 * cargo 120 on vh-morning) plus escrowed approvals (cargo 40, urban 80).
 */
import { useDashboardStore, planDraftRoute, listAvailableBackends } from '../src/store/dashboardStore';
import { resolveBackend } from '../src/services/dataBackends';
import { settleAuction } from '../src/services/creditsService';
import type { GeoPoint } from '../src/types/domain';

let failures = 0;
function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function walletOf(walletId: string): { balance: number; reserved: number } {
  const wallet = useDashboardStore.getState().wallets.find((entry) => entry.id === walletId)!;
  return { balance: wallet.balanceCredits, reserved: wallet.reservedCredits };
}

const s = useDashboardStore.getState();

// ---------------------------------------------------------------- 1. planning
s.initialize();
const afterInit = useDashboardStore.getState();
assert('init: mock backend active with 3 schematic zones', afterInit.backendId === 'mock' && afterInit.zones.length === 3);

const central: GeoPoint = { lat: 22.286, lng: 114.157 };
const stonecutters: GeoPoint = { lat: 22.32, lng: 114.12 };
const kwunTong: GeoPoint = { lat: 22.312, lng: 114.225 };

planDraftRoute(central, kwunTong);
let st = useDashboardStore.getState();
assert('plan on mock: route produced from Central pier -> Kwun Tong', st.plannedRoute !== null);
assert('plan on mock: no error', st.lastError === null, st.lastError ?? '');

s.setBackend('cad-geojson');
st = useDashboardStore.getState();
assert('backend switch: CAD pack loaded (284 zones)', st.backendId === 'cad-geojson' && st.zones.length === 284, `zones=${st.zones.length}`);
assert('backend switch: route draft reset', st.plannedRoute === null && st.routeZoneHits.length === 0);

planDraftRoute(central, stonecutters);
st = useDashboardStore.getState();
assert('plan on CAD: Central -> Stonecutters routes against 284 RFZ zones', st.plannedRoute !== null && st.lastError === null, st.lastError ?? '');
assert(
  'plan on CAD: exact origin spliced in and non-trivial detour',
  st.plannedRoute !== null
    && st.plannedRoute.waypoints.length >= 3
    && st.plannedRoute.waypoints[0].lat === central.lat
    && st.plannedRoute.waypoints[0].lng === central.lng
    && st.plannedRoute.distanceM > 3000,
  st.plannedRoute ? `${st.plannedRoute.waypoints.length} wp, ${st.plannedRoute.distanceM} m` : 'no route',
);

planDraftRoute(central, kwunTong);
st = useDashboardStore.getState();
// T10 update: 'Victoria Harbour (Low-altitude Economy Regulatory Sandbox)'
// now classifies as sandbox — the crossing is high-cost but PERMISSIBLE, so
// a route exists (defect 3 fixed). The hard-refusal case moved to the
// synthetic rfz-band test in defects.test.ts.
assert('sandbox: Central -> Kwun Tong now routes across the sandbox harbour (defect 3 fixed)', st.plannedRoute !== null && st.lastError === null, st.lastError ?? 'no route');

// ---------------------------------------------------------------- 2. credits
const now = '2026-09-26T12:00:00.000Z';

s.bidOnAuction('auction-vh-morning', 'wallet-harbour', 90);
st = useDashboardStore.getState();
const harbourAfterBid = walletOf('wallet-harbour');
const vhAuction = st.auctions.find((auction) => auction.id === 'auction-vh-morning')!;
assert('bid: escrow moves 90 credits from balance to reserved', st.lastError === null && harbourAfterBid.balance === 480 - 90 && harbourAfterBid.reserved === 40 + 90, JSON.stringify({ ...harbourAfterBid, err: st.lastError }));
assert('bid: auction now holds 3 bids', vhAuction.bids.length === 3, `bids=${vhAuction.bids.length}`);

s.bidOnAuction('auction-vh-morning', 'wallet-harbour', 1);
st = useDashboardStore.getState();
assert('bid: below reserve rejected with surfaced error', st.lastError !== null && st.lastError.includes('reserve'), st.lastError ?? '');

s.awardTopBid('auction-vh-morning');
st = useDashboardStore.getState();
const harbourAfterAward = walletOf('wallet-harbour');
const cargoAfterAward = walletOf('wallet-cargo');
const awarded = st.auctions.find((auction) => auction.id === 'auction-vh-morning')!;
// Harbour loses: its two bids (seed 40 + new 90) are refunded. Cargo wins:
// its 120 seed bid stays reserved; its 40 approval escrow is untouched.
assert('award: status awarded with winning bid id', awarded.status === 'awarded' && awarded.winningBidId !== null, awarded.status);
assert('award: losing bidder refunded both bids (130 back to balance)', st.lastError === null && harbourAfterAward.balance === 480 - 90 + 90 + 40, JSON.stringify({ balance: harbourAfterAward.balance, err: st.lastError }));
// Harbour's seed reservation was exactly its losing bid on this auction, so
// releasing it empties the wallet's reserved bucket entirely.
assert('award: losing reservations fully released (reserved -> 0)', harbourAfterAward.reserved === 0, `reserved=${harbourAfterAward.reserved}`);
assert('award: winning reservation held on winner wallet (cargo 120, escrow 40 untouched)', cargoAfterAward.reserved === 160 && cargoAfterAward.balance === 640, JSON.stringify(cargoAfterAward));
assert('award: ledger records won + lost entries', st.creditLedger.some((entry) => entry.reason.includes('Won auction')) && st.creditLedger.some((entry) => entry.reason.includes('Lost auction')));

// settleAuction is service-level (store has no settle action yet): drive the
// awarded auction to settlement with the service function directly.
const settled = settleAuction(st.auctions, st.wallets, 'auction-vh-morning', 'wallet-urban', now);
const cargoAfterSettle = settled.wallets.find((wallet) => wallet.id === 'wallet-cargo')!;
const urbanAfterSettle = settled.wallets.find((wallet) => wallet.id === 'wallet-urban')!;
assert('settle: winning reservation burned from winner (160 -> 40 = escrow only)', cargoAfterSettle.reservedCredits === 40, `reserved=${cargoAfterSettle.reservedCredits}`);
assert('settle: corridor owner credited (urban 260 -> 380)', urbanAfterSettle.balanceCredits === 260 + 120, `balance=${urbanAfterSettle.balanceCredits}`);
assert('settle: auction reached settled status', settled.auctions.find((auction) => auction.id === 'auction-vh-morning')!.status === 'settled');

// --------------------------------------------------------------- 3. approvals
// PRD S121: rejection without a reason must be refused with a surfaced error.
s.decideApprovalRequest('approval-cbd-04', 'rejected');
st = useDashboardStore.getState();
assert('reject: missing reason refused with surfaced error', st.lastError !== null && /reason is required/i.test(st.lastError), st.lastError ?? 'no error');

s.decideApprovalRequest('approval-cbd-04', 'rejected', 'Harbour traffic above threshold');
st = useDashboardStore.getState();
const urbanAfterReject = walletOf('wallet-urban');
assert('reject: request flipped to rejected', st.approvalRequests.find((request) => request.id === 'approval-cbd-04')!.status === 'rejected');
assert('reject: decision reason recorded on the request (PRD S121)', st.approvalRequests.find((request) => request.id === 'approval-cbd-04')!.decisionReason === 'Harbour traffic above threshold');
assert('reject: 80-credit escrow refunded to balance', urbanAfterReject.balance === 260 + 80 && urbanAfterReject.reserved === 0, JSON.stringify(urbanAfterReject));
assert('reject: ledger records the refund', st.creditLedger.some((entry) => entry.reason.includes('Refund for rejected')));

s.decideApprovalRequest('approval-kt-19', 'approved');
st = useDashboardStore.getState();
const cargoAfterBurn = walletOf('wallet-cargo');
assert('approve: request flipped to approved', st.approvalRequests.find((request) => request.id === 'approval-kt-19')!.status === 'approved');
assert('approve: escrow burned (reserved 160 -> 120, balance unchanged)', cargoAfterBurn.reserved === 120 && cargoAfterBurn.balance === 640, JSON.stringify(cargoAfterBurn));
assert('approve: ledger records the burn', st.creditLedger.some((entry) => entry.reason.includes('Escrow burned')));
assert('approvals: pending queue is empty after both decisions', st.approvalRequests.every((request) => request.status !== 'pending'));

// ------------------------------------------- 4. altitude bands + skycells
const { ALTITUDE_BANDS_M, droneInBand } = await import('../src/services/altitudeBands');
const { buildSkycells } = await import('../src/services/skycells');
assert('bands: five canonical PRD bands spanning 0-400 m', ALTITUDE_BANDS_M.length === 5 && ALTITUDE_BANDS_M[0].min === 0 && ALTITUDE_BANDS_M[4].max === 400);
s.setAltitudeBand([320, 400]);
st = useDashboardStore.getState();
assert('bands: store ceiling reaches 400 m (defect 1 clamp removed)', st.altitudeBandM[0] === 320 && st.altitudeBandM[1] === 400, JSON.stringify(st.altitudeBandM));
const probeDrone = st.drones[0];
assert('bands: droneInBand predicate edges inclusive', droneInBand(probeDrone, null) === true);
const cells = buildSkycells(st.drones, st.missions);
assert('skycells: deterministic lattice generated over HK bounds', cells.length > 100 && cells.every((cell) => cell.ring.length === 4));

// --------------------------------- 4b. PRD defects 2/3/6 (sandbox + scoping)
const { isSandboxZone } = await import('../src/services/zoneClassification');
st = useDashboardStore.getState();
const sandboxes = st.zones.filter((zone) => zone.kind === 'sandbox');
const restricted = st.zones.filter((zone) => zone.kind === 'rfz');
assert('defect 6: CAD pack split into sandbox + restricted kinds', sandboxes.length >= 20 && sandboxes.length + restricted.length === st.zones.length, `sandbox=${sandboxes.length} rfz=${restricted.length}`);
assert('defect 6: every sandbox zone matches the name pattern', sandboxes.every((zone) => isSandboxZone(zone)));
assert('defect 2: every drone carries an operatorId', st.drones.every((drone) => typeof drone.operatorId === 'string' && drone.operatorId.startsWith('wallet-')));
const scoped = st.drones.filter((drone) => drone.operatorId === st.currentOperatorId);
assert('defect 2: operator scope is a strict subset of the fleet', scoped.length > 0 && scoped.length < st.drones.length, `scoped=${scoped.length}/${st.drones.length}`);

// ------------------------------------------------ 5. provider + seam integrity
const backends = listAvailableBackends();
assert('seam: DataBackend registry exposes mock + cad-geojson + m3-server', backends.length === 3 && backends.some((backend) => backend.id === 'cad-geojson') && backends.some((backend) => backend.id === 'm3-server'));
const cadBackend = resolveBackend('cad-geojson');
assert('seam: CAD backend loads zones through the adapter interface', cadBackend.loadZones !== undefined && cadBackend.loadZones().length === 284);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
