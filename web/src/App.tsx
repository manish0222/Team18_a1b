import { useEffect, useState, type ReactNode } from 'react';
import { useActor } from './lib/actor';
import { href, matchPath, useLocation } from './lib/router';
import { useApi } from './lib/useApi';
import { money } from './lib/format';
import type { Health } from './types';
import { RiderPicker } from './components/pickers';
import { Overview } from './pages/Overview';
import { BookRide } from './pages/BookRide';
import { Wallet } from './pages/Wallet';
import { Analytics } from './pages/Analytics';
import { LiveMap } from './pages/LiveMap';
import { Reviews } from './pages/Reviews';
import { RiderDetailPage, RidersPage } from './pages/Riders';
import { VehicleDetailPage, VehiclesPage } from './pages/Vehicles';
import { TripDetailPage, TripsPage } from './pages/Trips';
import { Avatar, EmptyState } from './components/ui';
import { icons } from './components/icons';

const NAV: { group: string; items: { to: string; label: string; icon: string }[] }[] = [
  { group: 'Rider', items: [{ to: '/book', label: 'Book a trip', icon: 'book' }, { to: '/wallet', label: 'Wallet & audit trail', icon: 'wallet' }] },
  {
    group: 'Operations',
    items: [
      { to: '/map', label: 'Live map', icon: 'map' },
      { to: '/analytics', label: 'Fleet analytics', icon: 'analytics' },
      { to: '/reviews', label: 'Reviews & catalog', icon: 'reviews' },
    ],
  },
  {
    group: 'Records',
    items: [
      { to: '/riders', label: 'Riders', icon: 'riders' },
      { to: '/vehicles', label: 'Vehicles', icon: 'vehicles' },
      { to: '/trips', label: 'Trips', icon: 'trips' },
    ],
  },
];

// Browser-tab title per route, so history and tabs are distinguishable
const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Overview'], [/^\/book/, 'Book a trip'], [/^\/wallet/, 'Wallet & audit trail'], [/^\/map/, 'Live map'],
  [/^\/analytics/, 'Fleet analytics'], [/^\/reviews/, 'Reviews & catalog'], [/^\/riders\/./, 'Rider'], [/^\/riders/, 'Riders'],
  [/^\/vehicles\/./, 'Vehicle'], [/^\/vehicles/, 'Vehicles'], [/^\/trips\/./, 'Trip'], [/^\/trips/, 'Trips'],
];

const ROUTES: { pattern: string; render: (p: Record<string, string>) => ReactNode }[] = [
  { pattern: '/', render: () => <Overview /> },
  { pattern: '/book', render: () => <BookRide /> },
  { pattern: '/wallet', render: () => <Wallet /> },
  { pattern: '/analytics', render: () => <Analytics /> },
  { pattern: '/map', render: () => <LiveMap /> },
  { pattern: '/reviews', render: () => <Reviews /> },
  { pattern: '/riders', render: () => <RidersPage /> },
  { pattern: '/riders/:id', render: (p) => <RiderDetailPage id={p.id} /> },
  { pattern: '/vehicles', render: () => <VehiclesPage /> },
  { pattern: '/vehicles/:id', render: (p) => <VehicleDetailPage id={p.id} /> },
  { pattern: '/trips', render: () => <TripsPage /> },
  { pattern: '/trips/:id', render: (p) => <TripDetailPage id={p.id} /> },
];

function ActorSwitcher() {
  const { rider, riderId, setRiderId, loading } = useActor();
  return (
    <div className="actor">
      <RiderPicker
        id="actor-picker"
        label="Acting as"
        selected={riderId ? (
          <span className="actor-chosen">
            <Avatar name={rider?.name} size="sm" />
            <span className="actor-text">
              <strong>{rider?.name ?? (loading ? 'Loading…' : 'Rider')}</strong>
              <span className="actor-balance num">
                {rider ? money(rider.wallet_balance) : ''}
                {rider?.active_trip && <span className="actor-flag"><span className="dot-live" />On a trip</span>}
              </span>
            </span>
          </span>
        ) : null}
        onSelect={(r) => setRiderId(r.id)}
        hint={riderId ? undefined : 'Type a name, e.g. Reddy. No login needed.'}
      />
    </div>
  );
}

function HealthBanner() {
  const health = useApi<Health>('/health', undefined, { pollMs: 30_000 });
  if (health.error) {
    return <div className="banner banner--error" role="alert">{health.error.message}</div>;
  }
  const h = health.data;
  if (!h || (h.postgres.ok && h.mongodb.ok)) return null;
  return (
    <div className="banner banner--error" role="alert">
      {!h.postgres.ok && <span>PostgreSQL is not reachable, so browsing, booking and analytics will fail. </span>}
      {!h.mongodb.ok && <span>MongoDB is not reachable, so the map, reviews and catalog will fail. </span>}
      Start the database and this message will clear.
    </div>
  );
}

export function App() {
  const { path } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(path));
    document.title = `${t ? t[1] : 'Not found'} · RideSync`;
  }, [path]);

  let content: ReactNode = (
    <EmptyState title="That page does not exist." action={<a className="btn btn--primary btn--md" href="#/">Go to the overview</a>}>
      Check the address, or use the menu.
    </EmptyState>
  );
  for (const r of ROUTES) {
    const params = matchPath(r.pattern, path);
    if (params) { content = r.render(params); break; }
  }
  const isActive = (to: string) => path === to || (to !== '/' && path.startsWith(to + '/'));

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="brand-row">
          <a href="#/" className="brand" aria-label="RideSync overview">
            <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#F2B705" /><path d="M8 21c0-5 3.6-9 8-9s8 4 8 9" fill="none" stroke="#1B2430" strokeWidth="3" strokeLinecap="round" /><circle cx="16" cy="21" r="3" fill="#1B2430" /></svg>
            <span>RideSync</span>
          </a>
          <button className="menu-btn" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        <div className="sidebar-body" id="main-nav">
          <ActorSwitcher />
          <nav aria-label="Main">
            <a href="#/" className={`nav-link ${path === '/' ? 'is-active' : ''}`} aria-current={path === '/' ? 'page' : undefined}>{icons.overview}<span>Overview</span></a>
            {NAV.map((g) => (
              <div key={g.group} className="nav-group">
                <p className="nav-group-title">{g.group}</p>
                {g.items.map((i) => (
                  <a key={i.to} href={href(i.to)} className={`nav-link ${isActive(i.to) ? 'is-active' : ''}`} aria-current={isActive(i.to) ? 'page' : undefined}>
                    {icons[i.icon]}<span>{i.label}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <HealthBanner />
        {content}
      </main>
    </div>
  );
}
