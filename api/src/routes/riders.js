// Riders: browse, detail, wallet top-up, audit trail (wallet_audit_logs).
import {
  HttpError, requireUuid, parsePagination, pageResult, optionalDate, parseMoney, oneOf,
} from '../http.js';
import { TRIP_SELECT, ALLOWED_TRANSITIONS } from './trips.js';

const RIDER_SORTS = {
  name: 'r.name ASC, r.id',
  balance_desc: 'r.wallet_balance DESC, r.id',
  balance_asc: 'r.wallet_balance ASC, r.id',
  recent: 'r.updated_at DESC, r.id',
};

export const AUDIT_COLUMNS = `
  id, logged_at, action_type, amount_changed, balance_before, balance_after,
  reference_trip_id, running_balance, is_consistent`;

export function registerRiders(router, { pg }) {
  // GET /api/riders?q=&sort=&page=&pageSize=
  router.get('/api/riders', async ({ query }) => {
    const pageOpts = parsePagination(query);
    const q = (query.q ?? '').trim();
    const sort = RIDER_SORTS[oneOf(query.sort, Object.keys(RIDER_SORTS), 'name')];
    const where = q ? `WHERE r.name ILIKE $1 OR r.email ILIKE $1 OR r.id::text = $2` : '';
    const params = q ? [`%${q}%`, q.toLowerCase()] : [];

    const [list, count] = await Promise.all([
      pg.query(
        `SELECT r.id, r.name, r.email, r.wallet_balance, r.updated_at,
                EXISTS (SELECT 1 FROM trips t WHERE t.rider_id = r.id
                        AND t.status IN ('REQUESTED','IN_TRANSIT')) AS has_active_trip
         FROM riders r ${where}
         ORDER BY ${sort}
         LIMIT ${pageOpts.limit} OFFSET ${pageOpts.offset}`,
        params,
      ),
      pg.query(`SELECT COUNT(*)::bigint AS total FROM riders r ${where}`, params),
    ]);
    return pageResult(list.rows, count.rows[0].total, pageOpts);
  });

  // GET /api/riders/:id  - profile, active trip, stats, recent trips
  router.get('/api/riders/:id', async ({ params }) => {
    const id = requireUuid(params.id, 'riderId');
    const { rows } = await pg.query(
      `SELECT id, name, email, wallet_balance, created_at, updated_at FROM riders WHERE id = $1`,
      [id],
    );
    if (!rows.length) throw new HttpError(404, 'RIDER_NOT_FOUND', 'That rider does not exist.');

    const [active, stats, recent] = await Promise.all([
      pg.query(`${TRIP_SELECT} WHERE t.rider_id = $1 AND t.status IN ('REQUESTED','IN_TRANSIT')`, [id]),
      pg.query(
        `SELECT COUNT(*)::bigint AS total_trips,
                COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed,
                COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled,
                COALESCE(SUM(fare_amount) FILTER (WHERE status = 'COMPLETED'), 0) AS total_spent
         FROM trips WHERE rider_id = $1`,
        [id],
      ),
      pg.query(`${TRIP_SELECT} WHERE t.rider_id = $1 ORDER BY t.created_at DESC LIMIT 5`, [id]),
    ]);
    const activeTrip = active.rows[0] ? { ...active.rows[0], allowed_transitions: ALLOWED_TRANSITIONS[active.rows[0].status] } : null;
    return { ...rows[0], active_trip: activeTrip, stats: stats.rows[0], recent_trips: recent.rows };
  });

  // POST /api/riders/:id/topup { amount }  -> CALL sp_topup_wallet
  router.post('/api/riders/:id/topup', async ({ params, body }) => {
    const id = requireUuid(params.id, 'riderId');
    const amount = parseMoney(body.amount, 'amount');

    return pg.withTransaction(async (client) => {
      const before = await client.query(`SELECT wallet_balance FROM riders WHERE id = $1 FOR UPDATE`, [id]);
      if (!before.rows.length) throw new HttpError(404, 'RIDER_NOT_FOUND', 'That rider does not exist.');
      const call = await client.query(`CALL sp_topup_wallet($1, $2, NULL)`, [id, amount]);
      const audit = await client.query(
        `SELECT id, timestamp AS logged_at, action_type, amount_changed, balance_before, balance_after, reference_trip_id
         FROM wallet_audit_logs WHERE rider_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [id],
      );
      return {
        balance_before: before.rows[0].wallet_balance,
        balance_after: call.rows[0].p_new_balance,
        audit_entry: audit.rows[0] ?? null,
      };
    });
  });

  // GET /api/riders/:id/audit?from=&to=&page=&pageSize=
  //   -> fn_rider_audit_trail (running balance computed in SQL)
  router.get('/api/riders/:id/audit', async ({ params, query }) => {
    const id = requireUuid(params.id, 'riderId');
    const from = optionalDate(query.from, 'from');
    let to = optionalDate(query.to, 'to');
    // "to" is inclusive in the UI (a whole day); the SQL function uses < to
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) to = new Date(to.getTime() + 24 * 3600 * 1000);
    if (from && to && from >= to) {
      throw new HttpError(400, 'INVALID_DATE_RANGE', '"From" must be before "To".');
    }
    const pageOpts = parsePagination(query, { defaultSize: 20 });

    const rider = await pg.query(`SELECT id, name, email, wallet_balance FROM riders WHERE id = $1`, [id]);
    if (!rider.rows.length) throw new HttpError(404, 'RIDER_NOT_FOUND', 'That rider does not exist.');

    const args = [id, from, to];
    const [page, summary, series] = await Promise.all([
      pg.query(
        `SELECT ${AUDIT_COLUMNS} FROM fn_rider_audit_trail($1, $2, $3)
         ORDER BY logged_at DESC, id DESC LIMIT ${pageOpts.limit} OFFSET ${pageOpts.offset}`,
        args,
      ),
      pg.query(
        `SELECT COUNT(*)::bigint AS total,
                COALESCE(SUM(amount_changed) FILTER (WHERE amount_changed > 0), 0) AS total_in,
                COALESCE(-SUM(amount_changed) FILTER (WHERE amount_changed < 0), 0) AS total_out,
                (ARRAY_AGG(balance_before ORDER BY logged_at, id))[1] AS opening_balance,
                (ARRAY_AGG(running_balance ORDER BY logged_at DESC, id DESC))[1] AS closing_balance,
                COALESCE(BOOL_AND(is_consistent), TRUE) AS all_consistent
         FROM fn_rider_audit_trail($1, $2, $3)`,
        args,
      ),
      // chart points (oldest -> newest), capped
      pg.query(
        `SELECT logged_at, running_balance FROM (
           SELECT logged_at, running_balance, id FROM fn_rider_audit_trail($1, $2, $3)
           ORDER BY logged_at DESC, id DESC LIMIT 500) s
         ORDER BY logged_at, id`,
        args,
      ),
    ]);

    const s = summary.rows[0];
    return {
      rider: rider.rows[0],
      summary: {
        total_in: s.total_in,
        total_out: s.total_out,
        opening_balance: s.opening_balance,
        closing_balance: s.closing_balance,
        all_consistent: s.all_consistent,
      },
      series: series.rows,
      ...pageResult(page.rows, s.total, pageOpts),
    };
  });
}
