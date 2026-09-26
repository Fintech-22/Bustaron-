export type UserRole = 'operator' | 'admin';

export type NavSection = 'operations' | 'missions' | 'wallet' | 'approvals' | 'admin';

export type DroneStatus = 'nominal' | 'warning' | 'critical' | 'grounded';

export type MissionStatus = 'scheduled' | 'active' | 'paused' | 'completed';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type LayerId = 'drones' | 'routes' | 'restrictedZones' | 'weather' | 'grid';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type GeoPolygon = GeoPoint[];

export interface Drone {
  id: string;
  callsign: string;
  position: GeoPoint;
  altitudeM: number;
  status: DroneStatus;
  batteryPct: number;
  missionId: string;
  headingDeg: number;
  speedKph: number;
  lastSeenIso: string;
}

export interface Mission {
  id: string;
  name: string;
  operator: string;
  route: GeoPoint[];
  status: MissionStatus;
  riskLevel: RiskLevel;
  altitudeWindowM: [number, number];
  etaIso: string;
}

export interface WeatherAlert {
  id: string;
  type: string;
  severity: RiskLevel;
  area: GeoPolygon;
  windKph: number;
  validUntil: string;
}

export interface AirspaceZone {
  id: string;
  name: string;
  kind: 'rfz' | 'heliport' | 'sensitive' | 'corridor';
  polygon: GeoPolygon;
  restriction: string;
  riskLevel: RiskLevel;
}

export interface ComplianceWidget {
  id: string;
  title: string;
  value: string;
  status: RiskLevel;
  detail: string;
}

export interface SystemWidget {
  id: string;
  title: string;
  value: string;
  detail: string;
}

export type AuctionStatus = 'open' | 'awarded' | 'settled' | 'cancelled';

export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export interface CreditWallet {
  id: string;
  operatorName: string;
  /** Spendable credits. */
  balanceCredits: number;
  /** Credits locked by outstanding bids or escrowed approvals. */
  reservedCredits: number;
}

export interface AuctionBid {
  id: string;
  walletId: string;
  bidder: string;
  credits: number;
  submittedIso: string;
}

export interface SlotAuction {
  id: string;
  slotName: string;
  corridorZoneId: string;
  windowStartIso: string;
  windowEndIso: string;
  reserveCredits: number;
  status: AuctionStatus;
  bids: AuctionBid[];
  winningBidId: string | null;
}

export interface ApprovalRequest {
  id: string;
  missionName: string;
  operator: string;
  requestedAtIso: string;
  status: ApprovalDecision;
  riskLevel: RiskLevel;
  /** Credits already escrowed by the operator when the request was filed. */
  creditsEscrowed: number;
  walletId: string;
  reason: string;
  /** Admin's decision reason (PRD S121): required for rejections. */
  decisionReason?: string;
}

export interface CreditLedgerEntry {
  id: string;
  walletId: string;
  deltaCredits: number;
  reason: string;
  atIso: string;
}

export interface AppState {
  drones: Drone[];
  missions: Mission[];
  weatherAlerts: WeatherAlert[];
  zones: AirspaceZone[];
  complianceWidgets: ComplianceWidget[];
  systemWidgets: SystemWidget[];
  wallets: CreditWallet[];
  auctions: SlotAuction[];
  approvalRequests: ApprovalRequest[];
  creditLedger: CreditLedgerEntry[];
  lastUpdatedIso: string;
}

export interface LayerDefinition {
  id: LayerId;
  label: string;
  description: string;
}
