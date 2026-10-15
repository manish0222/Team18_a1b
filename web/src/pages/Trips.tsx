import { useApi } from '../lib/useApi';
import { Link, navigate, setQuery, useLocation } from '../lib/router';
import { useActor } from '../lib/actor';
import { dateTime, money, shortId } from '../lib/format';
import type { Page, RiderDetail, Trip, TripDetail, TripStatus, VehicleDetail } from '../types';
import { AuditTable } from '../components/AuditTable';
import { TripActions, TripStepper } from '../components/TripActions';
import {
  AsyncContent, Button, ClassTag, DataTable, EmptyState, PageHeader, Pagination, Panel, PersonCell, Plate, Segmented, SelectInput, Stars, StatusBadge,
} from '../components/ui';

export function TripsTable({ rows, hideRider = false, hideVehicle = false, busy = false }: { rows: Trip[]; hideRider?: boolean; hideVehicle?: boolean; busy?: boolean }) {
  return (
    <DataTable<Trip>
      caption="Trips"
      busy={busy}
      rows={rows}
      rowKey={(t) => t.id}
      onRowClick={(t) => navigate(`/trips/${t.id}`)}
      columns={[
        { key: 'when', header: 'Booked', render: (t) => <span className="nowrap">{dateTime(t.created_at)}</span> },
        { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
        ...(hideRider ? [] : [{ key: 'rider', header: 'Rider', className: 'nowrap', render: (t: Trip) => <PersonCell name={t.rider_name} size="sm" /> }]),
        ...(hideVehicle ? [] : [{ key: 'vehicle', header: 'Vehicle', render: (t: Trip) => <Plate plate={t.license_plate} size="sm" /> }]),
        { key: 'fare', header: 'Fare', align: 'right' as const, render: (t) => <span className="num">{money(t.fare_amount)}</span> },
      ]}
    />
  );
}

type StatusFilter = 'all' | 'active' | TripStatus;
const STATUS_QUERY: Record<StatusFilter, string> = {
  all: '', active: 'REQUESTED,IN_TRANSIT', REQUESTED: 'REQUESTED', IN_TRANSIT: 'IN_TRANSIT', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED',
};

export function TripsPage() {
  const { query } = useLocation();
  const status = (query.get('status') as StatusFilter) ?? 'all';
  const riderId = query.get('rider') ?? '';
  const vehicleId = query.get('vehicle') ?? '';
  const sort = query.get('sort') ?? 'recent';
  const page = Number(query.get('page') ?? 1);
  const trips = useApi<Page<Trip>>('/trips', { status: STATUS_QUERY[status] ?? '', riderId, vehicleId, sort, page, pageSize: 25 });
  const rider = useApi<RiderDetail>(riderId ? `/riders/${riderId}` : null);
  const vehicle = useApi<VehicleDetail>(vehicleId ? `/vehicles/${vehicleId}` : null);

  return (
    <>
      <PageHeader title="Trips" intro="Every booking. Filter to active trips to find the ones you can still move along." />
      <Panel flush>
        <div className="filters filters--inset">
          <div className="field">
            <span className="label-text">Status</span>
            <Segmented<StatusFilter>
              label="Status"
              value={status}
              onChange={(v) => setQuery({ status: v === 'all' ? null : v, page: null })}
              options={[
                { value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
          </div>
          <SelectInput label="Sort by" value={sort} onChange={(e) => setQuery({ sort: e.target.value, page: null })}>
            <option value="recent">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="fare_desc">Highest fare</option>
          </SelectInput>
          {(riderId || vehicleId) && (
            <div className="field">
              <span className="label-text">Showing only</span>
              <div className="inline-row">
                {riderId && <span className="chip">Rider: {rider.data?.name ?? shortId(riderId)} <button type="button" className="chip-x" aria-label="Remove rider filter" onClick={() => setQuery({ rider: null, page: null })}>×</button></span>}
                {vehicleId && <span className="chip">Vehicle: {vehicle.data?.license_plate ?? shortId(vehicleId)} <button type="button" className="chip-x" aria-label="Remove vehicle filter" onClick={() => setQuery({ vehicle: null, page: null })}>×</button></span>}
              </div>
            </div>
          )}
        </div>
        <AsyncContent state={trips} rows={8} isEmpty={(p) => p.items.length === 0} empty={<EmptyState title="No trips match these filters." />}>
          {(p) => (
            <>
              <TripsTable rows={p.items} busy={trips.loading} hideRider={!!riderId} hideVehicle={!!vehicleId} />
              <Pagination page={p.page} totalPages={p.totalPages} total={p.total} pageSize={p.pageSize} onChange={(n) => setQuery({ page: n })} />
            </>
          )}
        </AsyncContent>
      </Panel>
    </>
  );
}

export function TripDetailPage({ id }: { id: string }) {
  const trip = useApi<TripDetail>(`/trips/${id}`);
  const { refresh } = useActor();
  return (
    <AsyncContent state={trip} rows={8}>
      {(t) => (
        <>
          <PageHeader
            title={`Trip ${shortId(t.id)}`}
            intro={<>Booked {dateTime(t.created_at)} by <Link to={`/riders/${t.rider_id}`}>{t.rider_name}</Link></>}
            actions={<Button onClick={() => navigate('/wallet', { rider: t.rider_id })}>Rider’s wallet</Button>}
          />
          <div className="grid grid--2-1">
            <Panel title="Progress" className={t.allowed_transitions?.length ? 'panel--live' : ''}>
              <div className="stack">
                <TripStepper trip={t} />
                {t.allowed_transitions?.length ? (
                  <>
                    <p className="muted small">
                      Moving the trip out of “requested” or “in transit” frees the rider to book again (partial index <code>idx_active_rider_trip</code>). Cancelling refunds the fare.
                    </p>
                    <TripActions trip={t} onChanged={() => { trip.reload(); refresh(); }} />
                  </>
                ) : <p className="muted">This trip is {t.status === 'COMPLETED' ? 'finished' : 'cancelled'}. No further changes are possible.</p>}
              </div>
            </Panel>
            <Panel title="Details">
              <dl className="kv">
                <div><dt>Status</dt><dd><StatusBadge status={t.status} /></dd></div>
                <div><dt>Fare</dt><dd className="num">{money(t.fare_amount)}</dd></div>
                <div><dt>Vehicle</dt><dd className="inline-row"><Link to={`/vehicles/${t.vehicle_id}`}><Plate plate={t.license_plate} size="sm" /></Link><ClassTag value={t.vehicle_class} /></dd></div>
                <div><dt>Completed</dt><dd>{dateTime(t.completed_at)}</dd></div>
                <div><dt>Trip id</dt><dd><code className="small">{t.id}</code></dd></div>
              </dl>
            </Panel>
          </div>
          <Panel title="Wallet movements for this trip" flush>
            {t.audit_entries.length ? <AuditTable rows={t.audit_entries} /> : (
              <EmptyState title="No wallet movements are linked to this trip.">
                Seeded trips that were cancelled before payment have none, and neither do bookings made before this front end linked audit rows to trips.
              </EmptyState>
            )}
          </Panel>
          <Panel title="Rider’s review">
            {t.review_error ? <p className="muted">{t.review_error}</p>
              : t.review ? (
                <div className="stack stack--tight">
                  <div className="inline-row"><Stars value={t.review.rating} /><span className="muted small">{dateTime(t.review.created_at)}</span></div>
                  {t.review.comment && <p className="review-comment">“{t.review.comment}”</p>}
                  <div className="tag-row">{t.review.feedback_tags.map((x) => <span key={x} className="tag">{x}</span>)}</div>
                </div>
              ) : <p className="muted">No review for this trip.</p>}
          </Panel>
        </>
      )}
    </AsyncContent>
  );
}
