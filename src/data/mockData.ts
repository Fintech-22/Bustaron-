import type {
  AirspaceZone,
  AppState,
  ApprovalRequest,
  AuctionBid,
  ComplianceWidget,
  CreditLedgerEntry,
  CreditWallet,
  Drone,
  Mission,
  SlotAuction,
  SystemWidget,
  WeatherAlert,
} from '../types/domain';

export const mockDrones: Drone[] = [
  {
    id: 'drone-hk-01',
    callsign: 'BSN-01',
    operatorId: 'wallet-harbour',
    position: { lat: 22.303, lng: 114.171 },
    altitudeM: 118,
    status: 'nominal',
    batteryPct: 82,
    missionId: 'mission-vh-12',
    headingDeg: 82,
    speedKph: 42,
    lastSeenIso: '2026-09-24T13:35:00.000Z',
  },
  {
    id: 'drone-hk-02',
    callsign: 'BSN-07',
    operatorId: 'wallet-urban',
    position: { lat: 22.281, lng: 114.158 },
    altitudeM: 92,
    status: 'warning',
    batteryPct: 35,
    missionId: 'mission-cbd-04',
    headingDeg: 248,
    speedKph: 34,
    lastSeenIso: '2026-09-24T13:34:40.000Z',
  },
  {
    id: 'drone-hk-03',
    callsign: 'BSN-11',
    operatorId: 'wallet-cargo',
    position: { lat: 22.337, lng: 114.201 },
    altitudeM: 142,
    status: 'nominal',
    batteryPct: 68,
    missionId: 'mission-kt-19',
    headingDeg: 32,
    speedKph: 39,
    lastSeenIso: '2026-09-24T13:34:55.000Z',
  },
  {
    id: 'drone-hk-04',
    callsign: 'BSN-15',
    operatorId: 'wallet-harbour',
    position: { lat: 22.318, lng: 114.134 },
    altitudeM: 0,
    status: 'grounded',
    batteryPct: 91,
    missionId: 'mission-standby',
    headingDeg: 0,
    speedKph: 0,
    lastSeenIso: '2026-09-24T13:30:00.000Z',
  },
];

export const mockMissions: Mission[] = [
  {
    id: 'mission-vh-12',
    name: 'Victoria Harbour inspection',
    operator: 'Harbour Ops Desk',
    route: [
      { lat: 22.299, lng: 114.145 },
      { lat: 22.303, lng: 114.171 },
      { lat: 22.309, lng: 114.197 },
    ],
    status: 'active',
    riskLevel: 'medium',
    altitudeWindowM: [90, 130],
    etaIso: '2026-09-24T14:05:00.000Z',
  },
  {
    id: 'mission-cbd-04',
    name: 'Central district façade survey',
    operator: 'Urban Scan Team',
    route: [
      { lat: 22.274, lng: 114.139 },
      { lat: 22.281, lng: 114.158 },
      { lat: 22.287, lng: 114.176 },
    ],
    status: 'paused',
    riskLevel: 'high',
    altitudeWindowM: [70, 110],
    etaIso: '2026-09-24T14:22:00.000Z',
  },
  {
    id: 'mission-kt-19',
    name: 'Kowloon East logistics corridor',
    operator: 'Cargo Pilot Cell',
    route: [
      { lat: 22.319, lng: 114.178 },
      { lat: 22.337, lng: 114.201 },
      { lat: 22.356, lng: 114.217 },
    ],
    status: 'active',
    riskLevel: 'low',
    altitudeWindowM: [120, 160],
    etaIso: '2026-09-24T13:58:00.000Z',
  },
];

export const mockZones: AirspaceZone[] = [
  {
    id: 'zone-kai-tak',
    name: 'Kai Tak heli corridor',
    kind: 'heliport',
    polygon: [
      { lat: 22.313, lng: 114.182 },
      { lat: 22.328, lng: 114.205 },
      { lat: 22.314, lng: 114.222 },
      { lat: 22.298, lng: 114.199 },
    ],
    restriction: 'Notify before crossing below 150 m',
    riskLevel: 'medium',
  },
  {
    id: 'zone-govt-hq',
    name: 'Central Government Complex RFZ',
    kind: 'sensitive',
    polygon: [
      { lat: 22.277, lng: 114.161 },
      { lat: 22.284, lng: 114.171 },
      { lat: 22.277, lng: 114.181 },
      { lat: 22.269, lng: 114.17 },
    ],
    restriction: 'No loitering in M1 mock shell',
    riskLevel: 'high',
  },
  {
    id: 'zone-harbour-corridor',
    name: 'Harbour inspection corridor',
    kind: 'corridor',
    polygon: [
      { lat: 22.293, lng: 114.128 },
      { lat: 22.309, lng: 114.136 },
      { lat: 22.314, lng: 114.212 },
      { lat: 22.298, lng: 114.218 },
    ],
    restriction: 'Shared corridor, maintain assigned altitude band',
    riskLevel: 'low',
  },
];

export const mockWeatherAlerts: WeatherAlert[] = [
  {
    id: 'weather-squall-west',
    type: 'Crosswind cell',
    severity: 'medium',
    area: [
      { lat: 22.295, lng: 114.112 },
      { lat: 22.326, lng: 114.121 },
      { lat: 22.323, lng: 114.151 },
      { lat: 22.287, lng: 114.145 },
    ],
    windKph: 31,
    validUntil: '2026-09-24T15:00:00.000Z',
  },
  {
    id: 'weather-rain-east',
    type: 'Rain band',
    severity: 'high',
    area: [
      { lat: 22.322, lng: 114.202 },
      { lat: 22.356, lng: 114.212 },
      { lat: 22.348, lng: 114.242 },
      { lat: 22.313, lng: 114.232 },
    ],
    windKph: 44,
    validUntil: '2026-09-24T14:35:00.000Z',
  },
];

export const mockComplianceWidgets: ComplianceWidget[] = [
  {
    id: 'cad-rfz-sync',
    title: 'RFZ pack freshness',
    value: 'Mock current',
    status: 'low',
    detail: 'Static CAD-style constraints loaded for demo review.',
  },
  {
    id: 'fleet-docs',
    title: 'Fleet permit coverage',
    value: '96%',
    status: 'medium',
    detail: 'One standby craft has expiring insurance metadata in mock data.',
  },
  {
    id: 'incident-posture',
    title: 'Incident posture',
    value: 'Watch',
    status: 'medium',
    detail: 'Battery warning and eastern rain band require operator acknowledgement.',
  },
];

export const mockSystemWidgets: SystemWidget[] = [
  {
    id: 'ops-console',
    title: 'Operations console',
    value: 'Nominal',
    detail: 'Frontend-only state service is responding locally.',
  },
  {
    id: 'telemetry-link',
    title: 'Telemetry stream',
    value: 'Mock replay',
    detail: 'No live drone or backend connection is active in M1.',
  },
  {
    id: 'audit-buffer',
    title: 'Audit buffer',
    value: 'Read-only',
    detail: 'Persistence and blockchain ledger are intentionally out of scope.',
  },
];

export const mockWallets: CreditWallet[] = [
  // reservedCredits mirror the seeded open bids (harbour 40, cargo 120) AND the
  // escrowed approval requests below (cargo 40, urban 80); rejecting a request
  // must be able to refund without driving reserved negative.
  { id: 'wallet-harbour', operatorName: 'Harbour Ops Desk', balanceCredits: 480, reservedCredits: 40 },
  { id: 'wallet-urban', operatorName: 'Urban Scan Team', balanceCredits: 260, reservedCredits: 80 },
  { id: 'wallet-cargo', operatorName: 'Cargo Pilot Cell', balanceCredits: 640, reservedCredits: 160 },
];

const mockBidsHarbour: AuctionBid[] = [
  { id: 'bid-harbour-1', walletId: 'wallet-harbour', bidder: 'Harbour Ops Desk', credits: 40, submittedIso: '2026-09-24T12:40:00.000Z' },
  { id: 'bid-harbour-2', walletId: 'wallet-cargo', bidder: 'Cargo Pilot Cell', credits: 120, submittedIso: '2026-09-24T12:46:00.000Z' },
];

const mockBidsUrban: AuctionBid[] = [
  { id: 'bid-urban-1', walletId: 'wallet-urban', bidder: 'Urban Scan Team', credits: 65, submittedIso: '2026-09-24T12:51:00.000Z' },
];

export const mockAuctions: SlotAuction[] = [
  {
    id: 'auction-vh-morning',
    slotName: 'Victoria Harbour corridor · morning window',
    corridorZoneId: 'zone-harbour-corridor',
    windowStartIso: '2026-09-25T01:00:00.000Z',
    windowEndIso: '2026-09-25T04:00:00.000Z',
    reserveCredits: 30,
    status: 'open',
    bids: mockBidsHarbour,
    winningBidId: null,
  },
  {
    id: 'auction-cbd-evening',
    slotName: 'Central district façade slot · evening window',
    corridorZoneId: 'zone-govt-hq',
    windowStartIso: '2026-09-25T10:00:00.000Z',
    windowEndIso: '2026-09-25T12:00:00.000Z',
    reserveCredits: 50,
    status: 'open',
    bids: mockBidsUrban,
    winningBidId: null,
  },
];

export const mockApprovalRequests: ApprovalRequest[] = [
  {
    id: 'approval-kt-19',
    missionName: 'Kowloon East logistics corridor',
    operator: 'Cargo Pilot Cell',
    requestedAtIso: '2026-09-24T12:30:00.000Z',
    status: 'pending',
    riskLevel: 'low',
    creditsEscrowed: 40,
    walletId: 'wallet-cargo',
    reason: 'Scheduled resupply run inside approved corridor altitude band.',
  },
  {
    id: 'approval-cbd-04',
    missionName: 'Central district façade survey',
    operator: 'Urban Scan Team',
    requestedAtIso: '2026-09-24T12:55:00.000Z',
    status: 'pending',
    riskLevel: 'high',
    creditsEscrowed: 80,
    walletId: 'wallet-urban',
    reason: 'Facade survey adjacent to the Central Government Complex RFZ.',
  },
];

export const mockCreditLedger: CreditLedgerEntry[] = [
  { id: 'ledger-seed-harbour', walletId: 'wallet-harbour', deltaCredits: 40, reason: 'Escrow for Victoria Harbour morning bid', atIso: '2026-09-24T12:40:00.000Z' },
  { id: 'ledger-seed-cargo', walletId: 'wallet-cargo', deltaCredits: 120, reason: 'Escrow for Victoria Harbour morning bid', atIso: '2026-09-24T12:46:00.000Z' },
  { id: 'ledger-seed-urban', walletId: 'wallet-urban', deltaCredits: 65, reason: 'Escrow for Central district evening bid', atIso: '2026-09-24T12:51:00.000Z' },
];

export const initialMockState: AppState = {
  drones: mockDrones,
  missions: mockMissions,
  weatherAlerts: mockWeatherAlerts,
  zones: mockZones,
  complianceWidgets: mockComplianceWidgets,
  systemWidgets: mockSystemWidgets,
  wallets: mockWallets,
  auctions: mockAuctions,
  approvalRequests: mockApprovalRequests,
  creditLedger: mockCreditLedger,
  lastUpdatedIso: '2026-09-24T13:35:00.000Z',
};
