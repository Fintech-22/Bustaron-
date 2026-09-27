export type UserRole = 'operator' | 'admin';

/**
 * Sidebar sections. The operator console (PRD §11.2.2 / S111) is the first seven
 * entries — Live Map, Flight Plans, Credit Wallet, ESG Scorecard, Fleet,
 * Analytics, Alerts — followed by the admin-only Approvals Queue and Admin
 * Control. The internal id for the Flight Plans tab stays `missions` so existing
 * deep links and store transitions keep working; only its visible label changed.
 */
export type NavSection =
  | 'operations'
  | 'missions'
  | 'wallet'
  | 'esg'
  | 'fleet'
  | 'analytics'
  | 'alerts'
  | 'approvals'
  | 'admin';

export type DroneStatus = 'nominal' | 'warning' | 'critical' | 'grounded';

/** PRD S114 fleet tab vocabulary (distinct from the telemetry `DroneStatus`). */
export type FleetStatus = 'idle' | 'flying' | 'maintenance';

export type MissionStatus = 'scheduled' | 'active' | 'paused' | 'completed';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** PRD S115 alert severities. */
export type AlertSeverity = 'info' | 'warning' | 'critical';

export type LayerId = 'drones' | 'routes' | 'restrictedZones' | 'weather' | 'grid';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type GeoPolygon = GeoPoint[];

export interface Drone {
  id: string;
  callsign: string;
  /** Owning operator (PRD §11.3.3: operators see own drones, admin sees all). */
  operatorId: string;
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
  /** Direction the wind blows TOWARDS, degrees clockwise from north (PRD FR-OP-V5 wind arrows). */
  windDirectionDeg: number;
  /** Forecast precipitation rate, mm/h. Drives the map's precipitation shading. */
  precipitationMmH: number;
  validUntil: string;
}

export interface AirspaceZone {
  id: string;
  name: string;
  /** PRD §5.3 taxonomy: sandbox zones are permissible with authorization. */
  kind: 'rfz' | 'sandbox' | 'heliport' | 'sensitive' | 'corridor';
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
  /**
   * 64-hex transaction hash anchoring this movement (PRD S113). On the
   * `m3-server` backend this is the 3-of-3-signed block hash; on the offline
   * replay it is a content-addressed SHA-256 over the row. Optional so legacy
   * fixtures and server rows predating the field still type-check.
   */
  txHash?: string;
}

/** Real-time operator alert (PRD S115). */
export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: string;
  /** Owning drone id, or an empty string for system/weather-sourced alerts. */
  sourceDroneId: string;
  /** Human label for the source: the drone callsign, or the feed name. */
  sourceDrone: string;
  message: string;
  atIso: string;
  acknowledged: boolean;
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
