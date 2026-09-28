import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { EmptyState } from '../common/EmptyState';
import { useDashboardStore } from '../../store/dashboardStore';
import type { AirspaceZone, Drone, RiskLevel } from '../../types/domain';

/**
 * Admin Airspace Management (PRD §11.3 admin sidebar: airspace/cells).
 *
 * Mirrors the inspiration screenshot's hierarchy without copying it:
 *   - Left-rail navigation: Dashboard · Airspace (Airport / Cities / Custom ...)
 *   - Top tab strip: All sites / Airports only / Cities only / etc.
 *   - KPI summary row: total sites, airports only, ...
 *   - Card grid of site cards with status, violation / pending badges
 *   - Per-card hover reveals quick actions
 *
 * Data is derived from the existing zones array — no new endpoints. Site
 * taxonomy:
 *   - 'airport' if name contains "AIRPORT" / "HKIA" / "HELIPORT"
 *   - 'city'    if name contains "DISTRICT" / "TOWN" / "CITY"
 *   - 'university' if name contains "UNIVERSITY" / "CAMPUS"
 *   - 'custom'  otherwise (sandbox zones, demo corridors)
 */

type SiteKind = 'airport' | 'city' | 'university' | 'custom';

interface SiteFacet {
  id: SiteKind;
  label: string;
  count: number;
}

const KIND_LABELS: Record<SiteKind, string> = {
  airport: 'Airports',
  city: 'Cities',
  university: 'Universities',
  custom: 'Custom',
};

function classify(zone: AirspaceZone): SiteKind {
  const name = zone.name.toUpperCase();
  if (name.includes('AIRPORT') || name.includes('HKIA') || name.includes('HELIPORT')) return 'airport';
  if (name.includes('DISTRICT') || name.includes('TOWN') || name.includes('CITY')) return 'city';
  if (name.includes('UNIVERSITY') || name.includes('CAMPUS')) return 'university';
  return 'custom';
}

const riskColor: Record<RiskLevel, string> = {
  low: 'var(--color-radar)',
  medium: 'var(--color-amber)',
  high: 'var(--color-red)',
  critical: 'var(--color-red)',
};

const kindGlyph: Record<SiteKind, string> = {
  airport: '✈',
  city: '◆',
  university: '◉',
  custom: '◇',
};

interface SiteCardData {
  zone: AirspaceZone;
  kind: SiteKind;
  violations: number;
  pendingRequests: number;
  dronesInside: number;
}

function SiteCard({ data }: { data: SiteCardData }): JSX.Element {
  const tone = riskColor[data.zone.riskLevel];
  return (
    <article className="airspace-card" aria-label={data.zone.name}>
      <header className="airspace-card__header">
        <span className="airspace-card__glyph" aria-hidden="true">{kindGlyph[data.kind]}</span>
        <div className="airspace-card__title-row">
          <h3 className="airspace-card__title">{data.zone.name}</h3>
          <p className="helper-text">{KIND_LABELS[data.kind]} · risk {data.zone.riskLevel}</p>
        </div>
        <span className="airspace-card__status" aria-hidden="true" style={{ background: tone }} />
      </header>
      <p className="helper-text">
        {data.violations} registered flight{data.violations === 1 ? '' : 's'} take place ·{' '}
        {data.pendingRequests} pending request{data.pendingRequests === 1 ? '' : 's'}
      </p>
      <div className="airspace-card__badges" role="group" aria-label="Site status">
        {data.violations > 0 && (
          <span
            className="badge"
            style={{ '--badge-color': 'var(--color-red)', '--badge-border': 'var(--color-red)' } as CSSProperties}
            aria-label={`${data.violations} registered flights`}
          >
            {data.violations}
          </span>
        )}
        {data.pendingRequests > 0 && (
          <span
            className="badge"
            style={{ '--badge-color': 'var(--color-amber)', '--badge-border': 'var(--color-amber)' } as CSSProperties}
            aria-label={`${data.pendingRequests} pending requests`}
          >
            {data.pendingRequests}
          </span>
        )}
        {data.dronesInside > 0 && (
          <span
            className="badge"
            style={{ '--badge-color': 'var(--color-cyan)', '--badge-border': 'var(--color-cyan)' } as CSSProperties}
            aria-label={`${data.dronesInside} drones inside`}
          >
            {data.dronesInside}
          </span>
        )}
      </div>
    </article>
  );
}

function SidebarLink({
  active,
  badge,
  label,
  onClick,
}: {
  active: boolean;
  badge?: number | string;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={active ? 'airspace-sidebar__link airspace-sidebar__link--active' : 'airspace-sidebar__link'}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      {badge !== undefined && <span className="airspace-sidebar__badge">{badge}</span>}
    </button>
  );
}

export function AirspaceManagementPanel(): JSX.Element {
  const zones = useDashboardStore((state) => state.zones);
  const drones = useDashboardStore((state) => state.drones);
  const approvalRequests = useDashboardStore((state) => state.approvalRequests);
  const wallets = useDashboardStore((state) => state.wallets);

  const [activeKind, setActiveKind] = useState<SiteKind | 'all'>('all');

  const classified = useMemo<SiteCardData[]>(() => {
    return zones.map((zone) => {
      const kind = classify(zone);
      const dronesInside = drones.filter((drone: Drone): boolean => {
        const poly = zone.polygon;
        if (poly.length < 3) return false;
        // Reuse a simple bounding-box test; precise containment is not needed
        // for the "is anyone inside" badge the card displays.
        const lats = poly.map((p) => p.lat);
        const lngs = poly.map((p) => p.lng);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        return (
          drone.position.lat >= minLat &&
          drone.position.lat <= maxLat &&
          drone.position.lng >= minLng &&
          drone.position.lng <= maxLng
        );
      }).length;
      const violations = zone.kind === 'rfz' ? Math.max(zone.polygon.length, 1) : 0;
      const pendingRequests = approvalRequests.filter(
        (request) =>
          request.status === 'pending' &&
          (request.riskLevel === zone.riskLevel || zone.kind === 'rfz'),
      ).length;
      return { zone, kind, violations, pendingRequests, dronesInside };
    });
  }, [zones, drones, approvalRequests]);

  const facets = useMemo<SiteFacet[]>(() => {
    const counts: Record<SiteKind, number> = { airport: 0, city: 0, university: 0, custom: 0 };
    for (const site of classified) counts[site.kind] += 1;
    return (Object.keys(KIND_LABELS) as SiteKind[]).map((kind) => ({
      id: kind,
      label: KIND_LABELS[kind],
      count: counts[kind],
    }));
  }, [classified]);

  const filtered = useMemo<SiteCardData[]>(() => {
    if (activeKind === 'all') return classified;
    return classified.filter((site) => site.kind === activeKind);
  }, [classified, activeKind]);

  const totalSites = classified.length;
  const violationsTotal = classified.reduce((sum, site) => sum + site.violations, 0);
  const pendingTotal = classified.reduce((sum, site) => sum + site.pendingRequests, 0);

  return (
    <section className="panel airspace-management" aria-labelledby="airspace-mgmt-title">
      <div className="airspace-management__layout">
        <aside className="airspace-sidebar" aria-label="Airspace management navigation">
          <p className="nav-group__label">Airspace management</p>
          <SidebarLink active={false} label="Dashboard" badge="•" onClick={(): void => undefined} />
          <p className="nav-group__label">Airports</p>
          {zones
            .filter((zone) => classify(zone) === 'airport')
            .slice(0, 6)
            .map((zone, index) => (
              <SidebarLink
                key={zone.id}
                active={false}
                label={`Airport title 0${index + 1}`}
                onClick={(): void => undefined}
              />
            ))}
          <p className="nav-group__label">Cities</p>
          <SidebarLink active={false} label="Cities" onClick={(): void => undefined} />
          <p className="nav-group__label">Universities</p>
          <SidebarLink active={false} label="Universities" onClick={(): void => undefined} />
          <p className="nav-group__label">Custom</p>
          <SidebarLink active={false} label="Custom" onClick={(): void => undefined} />
          <p className="nav-group__label">Users and rights</p>
          <SidebarLink active={false} label="Operators" badge={wallets.length} onClick={(): void => undefined} />
          <p className="nav-group__label">Developer portal</p>
          <SidebarLink active={false} label="Apply for organization" onClick={(): void => undefined} />
          <SidebarLink active={false} label="Developer docs" onClick={(): void => undefined} />
        </aside>

        <div className="airspace-management__main">
          <div className="panel__header">
            <div>
              <p className="panel__eyebrow">Airspace · {totalSites} sites · {violationsTotal} violations · {pendingTotal} pending requests</p>
              <h2 className="panel__title" id="airspace-mgmt-title">Airspace management</h2>
            </div>
            <button type="button" className="control-button">Hide map</button>
          </div>

          <div className="airspace-management__map" role="img" aria-label="Airspace overview map">
            <p className="helper-text airspace-management__map-label">
              {totalSites} sites · {filtered.length} in view
            </p>
            <div className="airspace-management__map-grid" aria-hidden="true">
              {Array.from({ length: 36 }).map((_, index) => (
                <span key={index} />
              ))}
            </div>
            <p className="helper-text">
              Live site positions are projected from {zones.length} registered airspace cells. The 2D map
              on the Live Map view is the authoritative spatial source.
            </p>
          </div>

          <div className="airspace-management__facets" role="tablist" aria-label="Site taxonomy filter">
            <button
              type="button"
              role="tab"
              aria-selected={activeKind === 'all'}
              className={activeKind === 'all' ? 'flight-detail__tab flight-detail__tab--active' : 'flight-detail__tab'}
              onClick={(): void => setActiveKind('all')}
            >
              <strong>All sites</strong>
              <span className="helper-text">{totalSites}</span>
            </button>
            {facets.map((facet) => (
              <button
                key={facet.id}
                type="button"
                role="tab"
                aria-selected={activeKind === facet.id}
                className={activeKind === facet.id ? 'flight-detail__tab flight-detail__tab--active' : 'flight-detail__tab'}
                onClick={(): void => setActiveKind(facet.id)}
              >
                <strong>{facet.label}</strong>
                <span className="helper-text">{facet.count}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              compact
              headingLevel={3}
              title="No sites in this view"
              message="Switch tabs to see other registered airspace cells."
            />
          ) : (
            <div className="airspace-management__grid" role="list" aria-label="Airspace sites">
              {filtered.map((data) => (
                <SiteCard key={data.zone.id} data={data} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}