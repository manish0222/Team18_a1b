import { useEffect, useState } from 'react';
import { useApi } from '../lib/useApi';
import { Link, navigate, setQuery, useLocation } from '../lib/router';
import { useActor } from '../lib/actor';
import { count, dateTime, money } from '../lib/format';
import type { Page, RiderDetail, RiderSummary } from '../types';
import { TripsTable } from './Trips';
import { TripActions } from '../components/TripActions';
import {
  AsyncContent, Avatar, Button, DataTable, EmptyState, PageHeader, Pagination, Panel, PersonCell, Plate, SelectInput, Stat, StatusBadge, TextInput,
} from '../components/ui';

/** Debounce a text box into the URL so search survives reloads/back. */
export function useDebouncedQueryParam(name: string, delay = 300) {
  const { query } = useLocation();
  const urlValue = query.get(name) ?? '';
  const [text, setText] = useState(urlValue);
  useEffect(() => { setText(urlValue); }, [urlValue]);
  useEffect(() => {
    if (text === urlValue) return;
    const t = window.setTimeout(() => setQuery({ [name]: text, page: null }), delay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return [text, setText, urlValue] as const;
}

export function RidersPage() {
  const { query } = useLocation();
  const [text, setText, q] = useDebouncedQueryParam('q');
  const sort = query.get('sort') ?? 'name';
  const page = Number(query.get('page') ?? 1);
  const riders = useApi<Page<RiderSummary>>('/riders', { q, sort, page, pageSize: 25 });
  const { setRiderId, riderId } = useActor();

  return (
    <>
      <PageHeader title="Riders" intro="Everyone with a RideSync wallet. Search by name or email, open a rider to see their trips, or act as them." />
      <Panel flush>
        <div className="filters filters--inset">
          <div className="filters-wide">
            <TextInput label="Search" type="search" placeholder="Name or email, e.g. Reddy" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <SelectInput label="Sort by" value={sort} onChange={(e) => setQuery({ sort: e.target.value, page: null })}>
            <option value="name">Name</option>
            <option value="balance_desc">Highest balance</option>
            <option value="balance_asc">Lowest balance</option>
            <option value="recent">Recently active</option>
          </SelectInput>
        </div>
        <AsyncContent
          state={riders}
          rows={8}
          isEmpty={(p) => p.items.length === 0}
          empty={<EmptyState title={`No riders match “${q}”.`} action={<Button onClick={() => setText('')}>Clear search</Button>}>Try part of a name or an email address.</EmptyState>}
        >
          {(p) => (
            <>
              <DataTable<RiderSummary>
                caption="Riders"
                busy={riders.loading}
                rows={p.items}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate(`/riders/${r.id}`)}
                columns={[
                  { key: 'name', header: 'Rider', render: (r) => <PersonCell name={r.name} sub={r.email} /> },
                  { key: 'bal', header: 'Wallet', align: 'right', render: (r) => <span className="num">{money(r.wallet_balance)}</span> },
                  { key: 'active', header: 'Trip', render: (r) => (r.has_active_trip ? <span className="pill-live"><span className="dot-live" />On a trip</span> : <span className="muted">—</span>) },
                  {
                    key: 'act', header: '', align: 'right', className: 'hide-sm', render: (r) => r.id === riderId
                      ? <span className="muted small">Acting as</span>
                      : <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setRiderId(r.id); }}>Act as</button>,
                  },
                ]}
              />
              <Pagination page={p.page} totalPages={p.totalPages} total={p.total} pageSize={p.pageSize} onChange={(n) => setQuery({ page: n })} />
            </>
          )}
        </AsyncContent>
      </Panel>
    </>
  );
}

export function RiderDetailPage({ id }: { id: string }) {
  const rider = useApi<RiderDetail>(`/riders/${id}`);
  const { setRiderId, riderId, refresh } = useActor();

  return (
    <AsyncContent state={rider} rows={8}>
      {(r) => (
        <>
          <PageHeader
            title={<span className="title-with-avatar"><Avatar name={r.name} size="lg" />{r.name}</span>}
            intro={<>{r.email} · rider since {dateTime(r.created_at)}</>}
            actions={
              <div className="btn-row">
                {riderId === r.id
                  ? <Button variant="primary" onClick={() => navigate('/book')}>Book a trip</Button>
                  : <Button variant="primary" onClick={() => setRiderId(r.id)}>Act as {r.name.split(' ')[0]}</Button>}
                <Button onClick={() => navigate('/wallet', { rider: r.id })}>Wallet history</Button>
              </div>
            }
          />
          <Panel>
            <div className="stats">
              <Stat label="Wallet balance" value={money(r.wallet_balance)} note={`Updated ${dateTime(r.updated_at)}`} />
              <Stat label="Trips" value={count(r.stats.total_trips)} />
              <Stat label="Completed" value={count(r.stats.completed)} note={`${count(r.stats.cancelled)} cancelled`} />
              <Stat label="Spent on completed trips" value={money(r.stats.total_spent)} />
            </div>
          </Panel>
          {r.active_trip && (
            <Panel title="Active trip" className="panel--live">
              <div className="stack">
                <div className="inline-row">
                  <StatusBadge status={r.active_trip.status} />
                  <Plate plate={r.active_trip.license_plate} />
                  <span className="num">{money(r.active_trip.fare_amount)}</span>
                  <Link to={`/trips/${r.active_trip.id}`}>Open trip</Link>
                </div>
                <TripActions trip={r.active_trip} onChanged={() => { rider.reload(); refresh(); }} />
              </div>
            </Panel>
          )}
          <Panel title="Recent trips" flush aside={<Link to="/trips" query={{ rider: r.id }}>All trips</Link>}>
            {r.recent_trips.length ? <TripsTable rows={r.recent_trips} hideRider /> : <EmptyState title="No trips yet." action={<Button onClick={() => { setRiderId(r.id); navigate('/book'); }}>Book their first ride</Button>} />}
          </Panel>
        </>
      )}
    </AsyncContent>
  );
}
