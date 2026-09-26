import type { AirspaceZone, AppState, ComplianceWidget, Drone, LayerDefinition, Mission, SystemWidget, WeatherAlert } from '../types/domain';

export const layerDefinitions: LayerDefinition[] = [
  { id: 'drones', label: 'Drones', description: 'Active and grounded fleet markers' },
  { id: 'routes', label: 'Routes', description: 'Mock mission corridors' },
  { id: 'restrictedZones', label: 'RFZ', description: 'Restricted and sensitive airspace' },
  { id: 'weather', label: 'Weather', description: 'Mock wind and rain cells' },
  { id: 'grid', label: 'Grid', description: 'Hong Kong tactical reference grid' },
];

export const mockDrones: Drone[] = [
  {
    id: 'drone-hk-01',
    callsign: 'BSN-01',
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

export const initialMockState: AppState = {
  drones: mockDrones,
  missions: mockMissions,
  weatherAlerts: mockWeatherAlerts,
  zones: mockZones,
  complianceWidgets: mockComplianceWidgets,
  systemWidgets: mockSystemWidgets,
  lastUpdatedIso: '2026-09-24T13:35:00.000Z',
};
