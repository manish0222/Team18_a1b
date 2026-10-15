import { useApi } from '../lib/useApi';
import { Link, navigate, setQuery, useLocation } from '../lib/router';
import { count, dateTime, money } from '../lib/format';
import type { Page, VehicleDetail, VehicleSummary, VehicleClass } from '../types';
import { useDebouncedQueryParam } from './Riders';
import { TripsTable } from './Trips';
import { VehicleCatalogCard } from '../components/VehicleCatalogCard';
import {
  AsyncContent, Button, ClassTag, DataTable, EmptyState, PageHeader, Pagination, Panel, Plate, SelectInput, Stars, Stat, TextInput,
} from '../components/ui';

const CLASSES: VehicleClass[] = ['Standard', 'Comfort', 'XL', 'Executive', 'Black'];

export function VehiclesPage() {
  const { query } = useLocation();
  const [text, setText, q] = useDebouncedQueryParam('q');
  const cls = query.get('class') ?? '';
  const active = query.get('active') ?? '';
  const sort = query.get('sort') ?? 'plate';
  const page = Number(query.get('page') ?? 1);
  const vehicles = useApi<Page<VehicleSummary>>('/vehicles', { q, class: cls, active, sort, page, pageSize: 25 });

  return (
    <>
      <PageHeader title="Vehicles" intro="The registered fleet. Earnings come from the lifetime earnings snapshot (materialized view)." />
      <Panel flush>
        <div className="filters filters--inset">
          <TextInput label="Plate" type="search" placeholder="e.g. TS 09" value={text} onChange={(e) => setText(e.target.value)} />
          <SelectInput label="Class" value={cls} onChange={(e) => setQuery({ class: e.target.value, page: null })}>
            <option value="">All classes</option>
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectInput>
          <SelectInput label="Status" value={active} onChange={(e) => setQuery({ active: e.target.value, page: null })}>
            <option value="">Active and inactive</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </SelectInput>
          <SelectInput label="Sort by" value={sort} onChange={(e) => setQuery({ sort: e.target.value, page: null })}>
            <option value="plate">Plate</option>
            <option value="earnings_desc">Highest earnings</option>
            <option value="trips_desc">Most trips</option>
          </SelectInput>
        </div>
        <AsyncContent
          state={vehicles}
          rows={8}
          isEmpty={(p) => p.items.length === 0}
          empty={<EmptyState title="No vehicles match these filters." action={<Button onClick={() => { setText(''); setQuery({ class: null, active: null, q: null }); }}>Clear filters</Button>} />}
        >
          {(p) => (
            <>
              <DataTable<VehicleSummary>
                caption="Vehicles"
                busy={vehicles.loading}
                rows={p.items}
                rowKey={(v) => v.id}
                onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
                columns={[
                  { key: 'plate', header: 'Plate', render: (v) => <Plate plate={v.license_plate} size="sm" /> },
                  { key: 'class', header: 'Class', render: (v) => <ClassTag value={v.class} /> },
                  { key: 'active', header: 'Status', render: (v) => (v.is_active ? 'Active' : <span className="muted">Inactive</span>) },
                  { key: 'trips', header: 'Completed trips', align: 'right', render: (v) => <span className="num">{count(v.lifetime_trip_count)}</span> },
                  { key: 'earn', header: 'Earnings', align: 'right', render: (v) => <span className="num">{money(v.total_earnings)}</span> },
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

export function VehicleDetailPage({ id }: { id: string }) {
  const vehicle = useApi<VehicleDetail>(`/vehicles/${id}`);
  return (
    <AsyncContent state={vehicle} rows={8}>
      {(v) => (
        <>
          <header className="page-header">
            <div className="vehicle-title">
              <Plate plate={v.license_plate} size="lg" />
              <div className="inline-row">
                <ClassTag value={v.class} />
                <span className={v.is_active ? '' : 'muted'}>{v.is_active ? 'Active' : 'Inactive, cannot be booked'}</span>
              </div>
            </div>
            <div className="page-actions btn-row">
              {v.is_active && <Button variant="primary" onClick={() => navigate('/book', { vehicle: v.id })}>Book this vehicle</Button>}
              <Button onClick={() => navigate('/analytics', { vehicle: v.id })}>Revenue chart</Button>
              <Button onClick={() => navigate('/reviews', { vehicle: v.id })}>Reviews</Button>
            </div>
          </header>

          <Panel aside={<span className="muted small">Snapshot {dateTime(v.last_refreshed_at)}</span>} title="Lifetime numbers">
            <div className="stats">
              <Stat label="Completed trips" value={count(v.lifetime_trip_count)} />
              <Stat label="Earnings" value={money(v.total_earnings)} />
              <Stat label="Average fare" value={money(v.avg_fare_per_trip)} />
              <Stat label="Rider rating" value={v.reviews?.average_rating?.toFixed(2) ?? '—'} note={v.reviews ? <><Stars value={v.reviews.average_rating} /> {count(v.reviews.count)} reviews</> : v.mongo_error ?? undefined} />
            </div>
          </Panel>

          <div className="grid grid--2">
            <Panel title="Catalog document" aside={<span className="muted small">MongoDB VehicleMetadata</span>}>
              {v.mongo_error ? <p className="muted">{v.mongo_error}</p>
                : v.metadata ? <VehicleCatalogCard doc={v.metadata} showHeader={false} />
                  : <EmptyState title="No catalog document for this vehicle." />}
            </Panel>
            <Panel title="Recent trips" flush aside={<Link to="/trips" query={{ vehicle: v.id }}>All trips</Link>}>
              {v.recent_trips.length ? <TripsTable rows={v.recent_trips} hideVehicle /> : <EmptyState title="No trips yet." />}
            </Panel>
          </div>
        </>
      )}
    </AsyncContent>
  );
}
