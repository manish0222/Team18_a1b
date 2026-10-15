// Workflow 2 (window functions) + materialized view summary.
import { HttpError, requireUuid, parsePagination, pageResult, optionalDay } from '../http.js';
import { VEHICLE_CLASSES } from './vehicles.js';

async function mvSummary(pg) {
  const [totals, byClass, top, live] = await Promise.all([
    pg.query(
      `SELECT COUNT(*)::bigint AS vehicles,
              COUNT(*) FILTER (WHERE is_active)::bigint AS active_vehicles,
              COALESCE(SUM(lifetime_trip_count), 0)::bigint AS completed_trips,
              COALESCE(SUM(total_earnings), 0) AS total_earnings,
              ROUND(COALESCE(SUM(total_earnings) / NULLIF(SUM(lifetime_trip_count), 0), 0), 2) AS avg_fare,
              MAX(last_refreshed_at) AS last_refreshed_at
       FROM mv_vehicle_lifetime_earnings`,
    ),
    pg.query(
      `SELECT class, COUNT(*)::bigint AS vehicles,
              COALESCE(SUM(lifetime_trip_count), 0)::bigint AS completed_trips,
              COALESCE(SUM(total_earnings), 0) AS total_earnings
       FROM mv_vehicle_lifetime_earnings GROUP BY class ORDER BY total_earnings DESC`,
    ),
    pg.query(
      `SELECT vehicle_id, license_plate, class, lifetime_trip_count, total_earnings, avg_fare_per_trip
       FROM mv_vehicle_lifetime_earnings ORDER BY total_earnings DESC, license_plate LIMIT 10`,
    ),
    // Live count straight from trips, to show how stale the snapshot is
    pg.query(`SELECT COUNT(*)::bigint AS completed_trips FROM trips WHERE status = 'COMPLETED'`),
  ]);
  const t = totals.rows[0];
  return {
    ...t,
    live_completed_trips: live.rows[0].completed_trips,
    trips_since_refresh: live.rows[0].completed_trips - t.completed_trips,
    by_class: byClass.rows,
    top_vehicles: top.rows,
  };
}

export function registerAnalytics(router, { pg }) {
  // GET /api/analytics/summary  (mv_vehicle_lifetime_earnings)
  router.get('/api/analytics/summary', () => mvSummary(pg));

  // POST /api/analytics/summary/refresh  -> fn_refresh_vehicle_earnings_mv()
  router.post('/api/analytics/summary/refresh', async () => {
    const started = Date.now();
    await pg.query('SELECT fn_refresh_vehicle_earnings_mv()');
    const duration_ms = Date.now() - started;
    return { ...(await mvSummary(pg)), refresh_duration_ms: duration_ms };
  });

  // GET /api/analytics/dates  -> bounds for the date pickers
  router.get('/api/analytics/dates', async () => {
    const { rows } = await pg.query(
      `SELECT MIN(created_at)::date AS first_date, MAX(created_at)::date AS last_date
       FROM trips WHERE status = 'COMPLETED'`,
    );
    return rows[0];
  });

  // GET /api/analytics/ranking?date=YYYY-MM-DD&class=&page=&pageSize=
  //   DENSE_RANK() table from vw_vehicle_revenue_ranking (Part A query)
  router.get('/api/analytics/ranking', async ({ query }) => {
    const pageOpts = parsePagination(query, { defaultSize: 20 });
    let date = optionalDay(query.date, 'date');
    if (!date) {
      const { rows } = await pg.query(`SELECT MAX(created_at)::date AS d FROM trips WHERE status = 'COMPLETED'`);
      date = rows[0].d;
    }
    if (!date) return { date: null, ...pageResult([], 0, pageOpts) };

    const params = [date];
    let classFilter = '';
    if (VEHICLE_CLASSES.includes(query.class)) { params.push(query.class); classFilter = 'AND class = $2'; }

    const { rows } = await pg.query(
      `SELECT trip_date, vehicle_id, license_plate, class, daily_trips, daily_fare_revenue,
              seven_day_moving_avg_revenue, daily_performance_rank,
              COUNT(*) OVER ()::bigint AS total_count
       FROM vw_vehicle_revenue_ranking
       WHERE trip_date = $1 ${classFilter}
       ORDER BY daily_performance_rank, license_plate
       LIMIT ${pageOpts.limit} OFFSET ${pageOpts.offset}`,
      params,
    );
    let total = rows[0]?.total_count ?? 0;
    if (!rows.length && pageOpts.offset > 0) {
      const c = await pg.query(
        `SELECT COUNT(*)::bigint AS total FROM vw_vehicle_moving_avg WHERE trip_date = $1 ${classFilter}`, params,
      );
      total = c.rows[0].total;
    }
    const items = rows.map(({ total_count, ...r }) => r);
    return { date, ...pageResult(items, total, pageOpts) };
  });

  // GET /api/analytics/vehicles/:id/moving-average?from=&to=
  //   Per-vehicle series from vw_vehicle_moving_avg. The date filter is
  //   applied AFTER the window, so the first points still average over
  //   earlier days (same numbers as the full Part A query).
  router.get('/api/analytics/vehicles/:id/moving-average', async ({ params, query }) => {
    const id = requireUuid(params.id, 'vehicleId');
    const from = optionalDay(query.from, 'from');
    const to = optionalDay(query.to, 'to');
    const vehicle = await pg.query(`SELECT id, license_plate, class FROM vehicles WHERE id = $1`, [id]);
    if (!vehicle.rows.length) throw new HttpError(404, 'VEHICLE_NOT_FOUND', 'That vehicle does not exist.');
    const { rows } = await pg.query(
      `SELECT trip_date, daily_trips, daily_fare_revenue, seven_day_moving_avg_revenue
       FROM vw_vehicle_moving_avg
       WHERE vehicle_id = $1
         AND ($2::date IS NULL OR trip_date >= $2::date)
         AND ($3::date IS NULL OR trip_date <= $3::date)
       ORDER BY trip_date`,
      [id, from, to],
    );
    return { vehicle: vehicle.rows[0], points: rows };
  });
}
