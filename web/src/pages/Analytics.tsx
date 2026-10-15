// Workflow 2 + materialized view.
//  - 7-day moving average chart (vw_vehicle_moving_avg = Part A query steps 1-2)
//  - DENSE_RANK table for a day (vw_vehicle_revenue_ranking = Part A query)
//  - mv_vehicle_lifetime_earnings summary with "last refreshed" + Refresh
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { setQuery, useLocation, Link } from '../lib/router';
import { useToast } from '../lib/toast';
import { count, dateTime, day, money, moneyShort, relative } from '../lib/format';
import type { MovingAverageResponse, MvSummary, Page, RankingRow, VehicleClass } from '../types';
import { LineChart, SERIES_COLORS, HBarList } from '../components/charts';
import { VehiclePicker } from '../components/pickers';
import {
  AsyncContent, Button, ClassTag, DataTable, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, Panel, Plate,
  SelectInput, Stat, TextInput,
} from '../components/ui';

const CLASSES: VehicleClass[] = ['Standard', 'Comfort', 'XL', 'Executive', 'Black'];

export function Analytics() {
  const { query } = useLocation();
  const date = query.get('date') ?? '';
  const cls = query.get('class') ?? '';
  const page = Number(query.get('page') ?? 1);
  const vehiclesParam = query.get('vehicles');
  const singleVehicle = query.get('vehicle'); // from vehicle detail page

  const dates = useApi<{ first_date: string | null; last_date: string | null }>('/analytics/dates');
  const ranking = useApi<Page<RankingRow> & { date: string | null }>('/analytics/ranking', { date, class: cls, page, pageSize: 15 });

  // Vehicles on the chart: URL > ?vehicle= > top 3 of the ranking
  const chartIds = useMemo(() => {
    if (vehiclesParam) return vehiclesParam.split(',').filter(Boolean).slice(0, 3);
    if (singleVehicle) return [singleVehicle];
    return (ranking.data?.items ?? []).slice(0, 3).map((r) => r.vehicle_id);
  }, [vehiclesParam, singleVehicle, ranking.data]);

  const setChartIds = (ids: string[]) => setQuery({ vehicles: ids.slice(0, 3).join(',') || null, vehicle: null });
  const addVehicle = (id: string) => {
    if (chartIds.includes(id)) return;
    setChartIds([...chartIds, id].slice(-3));
  };

  return (
    <>
      <PageHeader
        title="Fleet analytics"
        intro="How much each vehicle earns. The chart and ranking run the Assignment 1 window-function query live. The summary numbers come from a materialized view, which only changes when it is refreshed."
      />

      <SummaryPanel />

      <Panel
        title="7-day moving average revenue"
        aside={<span className="muted small">Average of each vehicle’s last 7 days with a completed trip</span>}
      >
        <MovingAverageChart ids={chartIds} onRemove={(id) => setChartIds(chartIds.filter((x) => x !== id))} onAdd={addVehicle} />
      </Panel>

      <Panel
        title={`Daily ranking${ranking.data?.date ? ` for ${day(ranking.data.date)}` : ''}`}
        aside={<span className="muted small">DENSE_RANK() by 7-day average. Ties share a rank.</span>}
        flush
      >
        <div className="filters filters--inset">
          <TextInput
            label="Day"
            type="date"
            value={date || ranking.data?.date || ''}
            min={dates.data?.first_date ?? undefined}
            max={dates.data?.last_date ?? undefined}
            onChange={(e) => setQuery({ date: e.target.value, page: null })}
          />
          <SelectInput label="Class" value={cls} onChange={(e) => setQuery({ class: e.target.value, page: null })}>
            <option value="">All classes</option>
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectInput>
          {cls && <p className="field-hint filters-note">Ranks stay platform-wide, so filtering by class leaves gaps.</p>}
        </div>
        <AsyncContent
          state={ranking}
          isEmpty={(r) => r.items.length === 0}
          empty={<EmptyState title="No completed trips on this day.">Pick another day. Data covers {day(dates.data?.first_date)} to {day(dates.data?.last_date)}.</EmptyState>}
        >
          {(r) => (
            <>
              <DataTable<RankingRow>
                caption="Vehicles ranked by 7-day moving average revenue"
                busy={ranking.loading}
                rows={r.items}
                rowKey={(x) => x.vehicle_id}
                rowClassName={(x) => (chartIds.includes(x.vehicle_id) ? 'is-selected' : '')}
                onRowClick={(x) => addVehicle(x.vehicle_id)}
                columns={[
                  { key: 'rank', header: 'Rank', render: (x) => <span className={`rank ${x.daily_performance_rank <= 3 ? 'rank--top' : ''}`}>{x.daily_performance_rank}</span> },
                  { key: 'plate', header: 'Vehicle', render: (x) => <Link to={`/vehicles/${x.vehicle_id}`} onClick={(e) => e.stopPropagation()}><Plate plate={x.license_plate} size="sm" /></Link> },
                  { key: 'class', header: 'Class', render: (x) => <ClassTag value={x.class} /> },
                  { key: 'trips', header: 'Trips that day', align: 'right', render: (x) => <span className="num">{x.daily_trips}</span> },
                  { key: 'rev', header: 'Revenue that day', align: 'right', render: (x) => <span className="num">{money(x.daily_fare_revenue)}</span> },
                  { key: 'ma', header: '7-day average', align: 'right', render: (x) => <strong className="num">{money(x.seven_day_moving_avg_revenue)}</strong> },
                  {
                    key: 'chart', header: '', align: 'right', render: (x) => chartIds.includes(x.vehicle_id)
                      ? <span className="muted small">On chart</span>
                      : <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); addVehicle(x.vehicle_id); }}>Add to chart</button>,
                  },
                ]}
              />
              <Pagination page={r.page} totalPages={r.totalPages} total={r.total} pageSize={r.pageSize} onChange={(p) => setQuery({ page: p })} />
            </>
          )}
        </AsyncContent>
      </Panel>
    </>
  );
}

function SummaryPanel() {
  const summary = useApi<MvSummary>('/analytics/summary');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<ApiError | null>(null);
  const [override, setOverride] = useState<MvSummary | null>(null);
  const toast = useToast();
  const data = override ?? summary.data;

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await api.post<MvSummary>('/analytics/summary/refresh');
      setOverride(r);
      toast(`Snapshot refreshed in ${r.refresh_duration_ms} ms`);
    } catch (e) {
      setRefreshError(e as ApiError);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Panel
      title="Lifetime earnings snapshot"
      aside={
        <div className="inline-row">
          {data && (
            <span className="muted small" title={dateTime(data.last_refreshed_at)}>
              Last refreshed {relative(data.last_refreshed_at)}
            </span>
          )}
          <Button size="sm" variant="primary" busy={refreshing} onClick={refresh}>
            {refreshing ? 'Refreshing…' : 'Refresh snapshot'}
          </Button>
        </div>
      }
    >
      {refreshError && <ErrorState error={refreshError} compact />}
      <AsyncContent state={{ ...summary, data }} rows={3}>
        {(s) => (
          <div className="stack">
            {s.trips_since_refresh !== 0 && (
              <p className="note note--live">
                {count(Math.abs(s.trips_since_refresh))} trips have been completed since the last refresh, so these numbers are out of date. Refresh to include them.
              </p>
            )}
            <div className="stats">
              <Stat label="Completed trips" value={count(s.completed_trips)} note={`${count(s.live_completed_trips)} in the trips table now`} />
              <Stat label="Lifetime earnings" value={moneyShort(s.total_earnings)} note={money(s.total_earnings)} />
              <Stat label="Average fare" value={money(s.avg_fare)} />
              <Stat label="Vehicles" value={count(s.vehicles)} note={`${count(s.active_vehicles)} active`} />
            </div>
            <div className="grid grid--2">
              <div>
                <h3 className="subhead">Earnings by class</h3>
                <HBarList
                  ariaLabel="Lifetime earnings by vehicle class"
                  data={s.by_class.map((c) => ({ key: c.class, label: c.class, value: c.total_earnings }))}
                  formatValue={moneyShort}
                />
              </div>
              <div>
                <h3 className="subhead">Top earners</h3>
                <ol className="top-list">
                  {s.top_vehicles.slice(0, 5).map((v) => (
                    <li key={v.vehicle_id}>
                      <Link to={`/vehicles/${v.vehicle_id}`}><Plate plate={v.license_plate} size="sm" /></Link>
                      <span className="muted small">{v.lifetime_trip_count} trips</span>
                      <span className="num">{money(v.total_earnings)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </AsyncContent>
    </Panel>
  );
}

function MovingAverageChart({ ids, onRemove, onAdd }: { ids: string[]; onRemove: (id: string) => void; onAdd: (id: string) => void }) {
  const [state, setState] = useState<{ loading: boolean; error: ApiError | null; data: MovingAverageResponse[] }>({ loading: true, error: null, data: [] });
  const key = ids.join(',');

  useEffect(() => {
    if (!ids.length) { setState({ loading: false, error: null, data: [] }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all(ids.map((id) => api.get<MovingAverageResponse>(`/analytics/vehicles/${id}/moving-average`)))
      .then((data) => !cancelled && setState({ loading: false, error: null, data }))
      .catch((e) => !cancelled && setState((s) => ({ ...s, loading: false, error: e })));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="stack">
      <div className="chart-legend">
        {state.data.map((d, i) => (
          <span key={d.vehicle.id} className="legend-item">
            <span className="swatch" style={{ background: SERIES_COLORS[i % 3] }} />
            <Plate plate={d.vehicle.license_plate} size="sm" />
            <button type="button" className="link-btn" aria-label={`Remove ${d.vehicle.license_plate} from chart`} onClick={() => onRemove(d.vehicle.id)}>Remove</button>
          </span>
        ))}
        {ids.length < 3 && (
          <div className="legend-add">
            <VehiclePicker label="Add a vehicle" selected={null} onSelect={(v) => onAdd(v.id)} />
          </div>
        )}
      </div>
      {state.error ? <ErrorState error={state.error} />
        : state.loading && !state.data.length ? <LoadingBlock rows={5} />
          : !ids.length ? <EmptyState title="No vehicles on the chart.">Add one above, or click a row in the ranking below.</EmptyState>
            : (
              <LineChart
                ariaLabel="7-day moving average revenue per vehicle"
                series={state.data.map((d, i) => ({
                  id: d.vehicle.id,
                  label: d.vehicle.license_plate,
                  color: SERIES_COLORS[i % 3],
                  points: d.points.map((p) => {
                    const [y, m, dd] = p.trip_date.split('-').map(Number);
                    return { x: new Date(y, m - 1, dd).getTime(), y: p.seven_day_moving_avg_revenue, meta: `that day ${money(p.daily_fare_revenue)}` };
                  }),
                }))}
                formatY={(v) => money(v).replace('.00', '')}
                formatX={(v) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              />
            )}
    </div>
  );
}
