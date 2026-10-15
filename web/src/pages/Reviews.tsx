// Workflow 4 - $facet review analytics + VehicleMetadata catalog.
import { useState } from 'react';
import { useApi } from '../lib/useApi';
import { setQuery, useLocation, Link } from '../lib/router';
import { count, dateTime, endOfDayIso, startOfDayIso } from '../lib/format';
import type { Page, Review, ReviewAnalytics, VehicleDetail, VehicleMetadata, VehicleClass } from '../types';
import { BarChart, HBarList } from '../components/charts';
import { VehiclePicker } from '../components/pickers';
import { VehicleCatalogCard } from '../components/VehicleCatalogCard';
import {
  AsyncContent, ClassTag, EmptyState, LoadingBlock, ErrorState, PageHeader, Pagination, Panel, Plate, SelectInput, Stars, TextInput,
} from '../components/ui';

const STAR_COLORS: Record<number, string> = { 5: '#0B7A72', 4: '#3E9A8F', 3: '#9AA5B1', 2: '#D08A4E', 1: '#C2412D' };
const FEATURES = [
  { value: 'has_child_seat', label: 'Child seat' },
  { value: 'wheelchair_accessible', label: 'Wheelchair accessible' },
  { value: 'pet_friendly', label: 'Pet friendly' },
  { value: 'dashcam_enabled', label: 'Dashcam' },
];
const CLASSES: VehicleClass[] = ['Standard', 'Comfort', 'XL', 'Executive', 'Black'];

export function Reviews() {
  const { query } = useLocation();
  const vehicleId = query.get('vehicle') ?? '';
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const rating = query.get('rating') ?? '';
  const page = Number(query.get('page') ?? 1);

  const filters = { vehicleId, from: from ? startOfDayIso(from) : '', to: to ? endOfDayIso(to) : '' };
  const analytics = useApi<ReviewAnalytics>('/reviews/analytics', filters);
  const list = useApi<Page<Review>>('/reviews', { ...filters, rating, page, pageSize: 8 });
  const vehicle = useApi<VehicleDetail>(vehicleId ? `/vehicles/${vehicleId}` : null);

  return (
    <>
      <PageHeader
        title="Reviews & catalog"
        intro={<>What riders say about trips. All three charts come from one <code>$facet</code> aggregation over <code>TripReviews</code>. Below them is the flexible <code>VehicleMetadata</code> document for each car.</>}
      />

      <Panel>
        <div className="filters">
          <div className="filters-wide">
            <VehiclePicker
              label="Vehicle"
              selected={vehicleId ? (vehicle.data ? <Plate plate={vehicle.data.license_plate} /> : 'Loading…') : null}
              onSelect={(v) => setQuery({ vehicle: v.id, page: null })}
              onClear={vehicleId ? () => setQuery({ vehicle: null, page: null }) : undefined}
              hint={vehicleId ? undefined : 'Leave empty to see the whole fleet.'}
            />
          </div>
          <TextInput label="From" type="date" value={from} max={to || undefined} onChange={(e) => setQuery({ from: e.target.value, page: null })} />
          <TextInput label="To" type="date" value={to} min={from || undefined} onChange={(e) => setQuery({ to: e.target.value, page: null })} />
        </div>
      </Panel>

      <AsyncContent
        state={analytics}
        rows={6}
        isEmpty={(a) => a.overall_summary.total_reviews === 0}
        empty={<Panel><EmptyState title="No reviews match these filters.">Clear the vehicle or widen the dates.</EmptyState></Panel>}
      >
        {(a) => (
          <div className="grid grid--reviews">
            <Panel title="Overall rating">
              <div className="rating-hero">
                <span className="rating-number">{a.overall_summary.average_rating?.toFixed(2) ?? '—'}</span>
                <Stars value={a.overall_summary.average_rating} />
                <span className="muted small">from {count(a.overall_summary.total_reviews)} reviews · spread ±{a.overall_summary.std_dev_rating ?? '—'}</span>
              </div>
            </Panel>
            <Panel title="Rating distribution">
              <BarChart
                ariaLabel="Number of reviews per star rating"
                data={a.rating_distribution.map((r) => ({ label: `${r.stars}★`, value: r.count, color: STAR_COLORS[r.stars] }))}
                formatValue={count}
              />
            </Panel>
            <Panel title="Most mentioned feedback">
              {a.top_feedback_tags.length ? (
                <HBarList ariaLabel="Top feedback tags" data={a.top_feedback_tags.map((t) => ({ key: t.tag, label: t.tag, value: t.tag_count }))} formatValue={count} />
              ) : <p className="muted">No tags.</p>}
            </Panel>
          </div>
        )}
      </AsyncContent>

      <div className="grid grid--2">
        <Panel
          title="Latest reviews"
          flush
          aside={
            <SelectInput label="Stars" value={rating} onChange={(e) => setQuery({ rating: e.target.value, page: null })}>
              <option value="">Any rating</option>
              {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s} stars</option>)}
            </SelectInput>
          }
        >
          <AsyncContent state={list} rows={5} isEmpty={(l) => l.items.length === 0} empty={<EmptyState title="No reviews to show." />}>
            {(l) => (
              <>
                <ul className="review-list">
                  {l.items.map((r) => (
                    <li key={r.review_id}>
                      <div className="review-head">
                        <Stars value={r.rating} />
                        {r.vehicle ? <Link to={`/vehicles/${r.vehicle_id}`}><Plate plate={r.vehicle.license_plate} size="sm" /></Link> : <span className="muted small">Vehicle not in PostgreSQL</span>}
                        <span className="muted small">{dateTime(r.created_at)}</span>
                      </div>
                      {r.comment && <p className="review-comment">“{r.comment}”</p>}
                      <div className="tag-row">{r.feedback_tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                      <Link to={`/trips/${r.trip_id}`} className="small">View trip</Link>
                    </li>
                  ))}
                </ul>
                <Pagination page={l.page} totalPages={l.totalPages} total={l.total} pageSize={l.pageSize} onChange={(p) => setQuery({ page: p })} />
              </>
            )}
          </AsyncContent>
        </Panel>

        <CatalogBrowser focusVehicleId={vehicleId || null} />
      </div>
    </>
  );
}

function CatalogBrowser({ focusVehicleId }: { focusVehicleId: string | null }) {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const [feature, setFeature] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = picked ?? focusVehicleId;

  const list = useApi<Page<VehicleMetadata>>('/catalog/vehicles', { q, class: cls, feature, page, pageSize: 6 });
  const doc = useApi<VehicleMetadata>(selectedId ? `/catalog/vehicles/${selectedId}` : null);
  const firstId = list.data?.items[0]?.vehicle_id ?? null;
  const shownId = selectedId ?? firstId;
  const shown = useApi<VehicleMetadata>(!selectedId && shownId ? `/catalog/vehicles/${shownId}` : null);
  const current = selectedId ? doc : shown;

  return (
    <Panel title="Vehicle catalog" aside={<span className="muted small">MongoDB VehicleMetadata</span>}>
      <div className="stack">
        <div className="filters filters--compact">
          <TextInput label="Plate" placeholder="e.g. TS 09" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <SelectInput label="Class" value={cls} onChange={(e) => { setCls(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectInput>
          <SelectInput label="Has feature" value={feature} onChange={(e) => { setFeature(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            {FEATURES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </SelectInput>
        </div>
        <AsyncContent state={list} rows={3} isEmpty={(l) => l.items.length === 0} empty={<EmptyState title="No catalog documents match." />}>
          {(l) => (
            <>
              <ul className="catalog-list">
                {l.items.map((v) => (
                  <li key={v.vehicle_id}>
                    <button type="button" className={`catalog-pick ${shownId === v.vehicle_id ? 'is-on' : ''}`} onClick={() => setPicked(v.vehicle_id)} aria-pressed={shownId === v.vehicle_id}>
                      <Plate plate={v.license_plate} size="sm" />
                      <ClassTag value={v.class} />
                      <span className="muted small">{v.inspection_count ?? 0} {v.inspection_count === 1 ? 'inspection' : 'inspections'}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={l.page} totalPages={l.totalPages} total={l.total} pageSize={l.pageSize} onChange={setPage} />
            </>
          )}
        </AsyncContent>
        {current.error ? <ErrorState error={current.error} onRetry={current.reload} />
          : current.data ? <VehicleCatalogCard doc={current.data} />
            : shownId ? <LoadingBlock rows={4} /> : null}
      </div>
    </Panel>
  );
}
