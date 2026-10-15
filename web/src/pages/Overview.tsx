import { useActor } from '../lib/actor';
import { navigate } from '../lib/router';
import { useApi } from '../lib/useApi';
import { count, money, moneyShort, relative } from '../lib/format';
import { Link } from '../lib/router';
import type { Health, MvSummary, Page, RiderSummary } from '../types';
import { AsyncContent, Button, PageHeader, Panel, PersonCell, Plate, Stat, StatusBadge } from '../components/ui';

const WORKFLOWS = [
  { to: '/book', title: 'Book a trip', text: 'Charge a rider’s wallet and create a trip in one database transaction.', source: 'sp_book_trip_atomic · trg_audit_wallet_balance' },
  { to: '/analytics', title: 'Fleet analytics', text: '7-day moving average revenue and daily DENSE_RANK of every vehicle.', source: 'window functions · mv_vehicle_lifetime_earnings' },
  { to: '/map', title: 'Live map', text: 'Nearest available vehicles within 5 km of any point in the city.', source: '$geoNear on TelemetryPings' },
  { to: '/reviews', title: 'Reviews & catalog', text: 'Rating mix, common feedback and each vehicle’s inspection record.', source: '$facet on TripReviews · VehicleMetadata' },
];

export function Overview() {
  const { rider } = useActor();
  const summary = useApi<MvSummary>('/analytics/summary');
  const health = useApi<Health>('/health', undefined, { pollMs: 15_000 });

  return (
    <>
      <PageHeader
        title="RideSync console"
        intro="Riders book trips and check their wallet. The operations team watches the fleet, the map and rider feedback. Everything here runs on the inherited PostgreSQL and MongoDB databases."
      />

      <div className="grid grid--2-1">
        <Panel title="What you can do">
          <ul className="workflow-list">
            {WORKFLOWS.map((w) => (
              <li key={w.to}>
                <Link to={w.to} className="workflow-link">
                  <span className="workflow-title">{w.title}</span>
                  <span className="workflow-text">{w.text}</span>
                  <code className="workflow-source">{w.source}</code>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="stack">
          {rider ? (
            <Panel title="You are acting as">
              <div className="stack">
                <Link to={`/riders/${rider.id}`} className="plain-link"><PersonCell name={rider.name} sub={rider.email} size="lg" /></Link>
                <Stat label="Wallet balance" value={money(rider.wallet_balance)} />
                {rider.active_trip ? (
                  <p className="inline-row">
                    <StatusBadge status={rider.active_trip.status} />
                    <Plate plate={rider.active_trip.license_plate} size="sm" />
                    <Link to={`/trips/${rider.active_trip.id}`}>Open trip</Link>
                  </p>
                ) : (
                  <Button variant="primary" onClick={() => navigate('/book')}>Book a trip</Button>
                )}
              </div>
            </Panel>
          ) : <StartHere />}

          <Panel title="Databases">
            <AsyncContent state={health} rows={2}>
              {(h) => (
                <ul className="health">
                  <li className={h.postgres.ok ? 'is-ok' : 'is-bad'}>PostgreSQL {h.postgres.ok ? `connected (${h.postgres.ms} ms)` : 'unreachable'}</li>
                  <li className={h.mongodb.ok ? 'is-ok' : 'is-bad'}>MongoDB {h.mongodb.ok ? `connected (${h.mongodb.ms} ms)` : 'unreachable'}</li>
                  <li className={h.simulator.running && !h.simulator.last_error ? 'is-ok' : 'is-off'}>
                    Live pings {h.simulator.running ? `${count(h.simulator.pings_inserted ?? 0)} sent, last ${relative(h.simulator.last_tick_at)}` : 'off'}
                  </li>
                </ul>
              )}
            </AsyncContent>
          </Panel>
        </div>
      </div>

      <Panel title="Fleet at a glance" aside={summary.data && <span className="muted">Snapshot from {relative(summary.data.last_refreshed_at)}</span>}>
        <AsyncContent state={summary} rows={2}>
          {(s) => (
            <div className="stats">
              <Stat label="Vehicles" value={count(s.vehicles)} note={`${count(s.active_vehicles)} active`} />
              <Stat label="Completed trips" value={count(s.completed_trips)} />
              <Stat label="Lifetime earnings" value={moneyShort(s.total_earnings)} />
              <Stat label="Average fare" value={money(s.avg_fare)} />
            </div>
          )}
        </AsyncContent>
      </Panel>
    </>
  );
}

/** First-run: suggest a few riders who can book right away (money, no active trip). */
function StartHere() {
  const { setRiderId } = useActor();
  const riders = useApi<Page<RiderSummary>>('/riders', { sort: 'balance_desc', pageSize: 24, page: 3 });
  const picks = (riders.data?.items ?? []).filter((r) => !r.has_active_trip).slice(0, 4);
  return (
    <Panel title="Start here" className="panel--live">
      <div className="stack">
        <p className="muted small">Choose a rider to act as. There is no login; you can switch any time from the menu.</p>
        <AsyncContent state={riders} rows={4}>
          {() => (
            <ul className="quick-picks">
              {picks.map((r) => (
                <li key={r.id}>
                  <button type="button" className="quick-pick" onClick={() => { setRiderId(r.id); navigate('/book'); }}>
                    <PersonCell name={r.name} sub={money(r.wallet_balance) + ' in wallet'} />
                    <span className="quick-pick-go">Act as</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AsyncContent>
      </div>
    </Panel>
  );
}
