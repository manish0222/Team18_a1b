// Trips: browse/detail, Workflow 1 (book a trip), and status transitions.
import {
  HttpError, requireUuid, optionalUuid, parsePagination, pageResult, optionalDate, parseMoney, oneOf,
} from '../http.js';
import { mapPgError } from '../errors.js';

export const TRIP_STATUSES = ['REQUESTED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];

// Mirrors the transition table enforced by sp_update_trip_status (sql/07).
// Only used to decide which buttons to show; the database is the authority.
export const ALLOWED_TRANSITIONS = {
  REQUESTED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TRIP_SELECT = `
  SELECT t.id, t.rider_id, r.name AS rider_name, t.vehicle_id, v.license_plate, v.class AS vehicle_class,
         t.fare_amount, t.status, t.created_at, t.completed_at
  FROM trips t
  JOIN riders r ON r.id = t.rider_id
  JOIN vehicles v ON v.id = t.vehicle_id`;

const AUDIT_FOR_TRIP = `
  SELECT id, timestamp AS logged_at, action_type, amount_changed, balance_before, balance_after, reference_trip_id
  FROM wallet_audit_logs WHERE reference_trip_id = $1 ORDER BY timestamp`;

const TRIP_SORTS = {
  recent: 't.created_at DESC, t.id',
  oldest: 't.created_at ASC, t.id',
  fare_desc: 't.fare_amount DESC, t.id',
};

function withTransitions(trip) {
  return trip ? { ...trip, allowed_transitions: ALLOWED_TRANSITIONS[trip.status] ?? [] } : trip;
}

export function registerTrips(router, { pg, mongo }) {
  // GET /api/trips?status=&riderId=&vehicleId=&from=&to=&sort=&page=&pageSize=
  router.get('/api/trips', async ({ query }) => {
    const pageOpts = parsePagination(query);
    const conds = [];
    const params = [];
    const add = (sql, value) => { params.push(value); conds.push(sql.replace('?', `$${params.length}`)); };

    if (query.status) {
      const statuses = String(query.status).split(',').filter((s) => TRIP_STATUSES.includes(s));
      if (statuses.length) add('t.status = ANY(?)', statuses);
    }
    const riderId = optionalUuid(query.riderId, 'riderId');
    if (riderId) add('t.rider_id = ?', riderId);
    const vehicleId = optionalUuid(query.vehicleId, 'vehicleId');
    if (vehicleId) add('t.vehicle_id = ?', vehicleId);
    const from = optionalDate(query.from, 'from');
    if (from) add('t.created_at >= ?', from);
    const to = optionalDate(query.to, 'to');
    if (to) add('t.created_at < ?', to);

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sort = TRIP_SORTS[oneOf(query.sort, Object.keys(TRIP_SORTS), 'recent')];
    const [list, count] = await Promise.all([
      pg.query(`${TRIP_SELECT} ${where} ORDER BY ${sort} LIMIT ${pageOpts.limit} OFFSET ${pageOpts.offset}`, params),
      pg.query(`SELECT COUNT(*)::bigint AS total FROM trips t ${where}`, params),
    ]);
    return pageResult(list.rows, count.rows[0].total, pageOpts);
  });

  // GET /api/trips/:id - trip, wallet movements caused by it, review (Mongo)
  router.get('/api/trips/:id', async ({ params }) => {
    const id = requireUuid(params.id, 'tripId');
    const { rows } = await pg.query(`${TRIP_SELECT} WHERE t.id = $1`, [id]);
    if (!rows.length) throw new HttpError(404, 'TRIP_NOT_FOUND', 'That trip does not exist.');
    const audit = await pg.query(AUDIT_FOR_TRIP, [id]);

    // The review lives in MongoDB. If Mongo is down the trip page still works.
    let review = null;
    let review_error = null;
    try {
      review = await mongo.collection('TripReviews').findOne({ trip_id: id }, { projection: { _id: 0 } });
    } catch (err) {
      review_error = 'Reviews are unavailable right now (MongoDB not reachable).';
    }
    return { ...withTransitions(rows[0]), audit_entries: audit.rows, review, review_error };
  });

  // POST /api/trips { riderId, vehicleId, fare }  ==> WORKFLOW 1
  // One transaction: read balance (locked) -> CALL sp_book_trip_atomic ->
  // read balance again -> read the audit row the trigger wrote.
  router.post('/api/trips', async ({ body }) => {
    const riderId = requireUuid(body.riderId, 'riderId');
    const vehicleId = requireUuid(body.vehicleId, 'vehicleId');
    const fare = parseMoney(body.fare, 'fare');

    try {
      return await pg.withTransaction(async (client) => {
        const before = await client.query(
          `SELECT wallet_balance FROM riders WHERE id = $1 FOR UPDATE`, [riderId],
        );
        const call = await client.query(`CALL sp_book_trip_atomic($1, $2, $3, NULL)`, [riderId, vehicleId, fare]);
        const tripId = call.rows[0].p_trip_id;
        const [after, trip, audit] = await Promise.all([
          client.query(`SELECT wallet_balance FROM riders WHERE id = $1`, [riderId]),
          client.query(`${TRIP_SELECT} WHERE t.id = $1`, [tripId]),
          client.query(AUDIT_FOR_TRIP, [tripId]),
        ]);
        return {
          trip: withTransitions(trip.rows[0]),
          balance_before: before.rows[0]?.wallet_balance ?? null,
          balance_after: after.rows[0]?.wallet_balance ?? null,
          audit_entries: audit.rows,
        };
      });
    } catch (err) {
      const httpErr = mapPgError(err);
      if (!httpErr) throw err;
      // Add context the UI needs to explain the failure (read after rollback).
      if (httpErr.code === 'INSUFFICIENT_BALANCE') {
        const { rows } = await pg.query(`SELECT wallet_balance FROM riders WHERE id = $1`, [riderId]);
        const balance = rows[0]?.wallet_balance ?? null;
        httpErr.details = { ...httpErr.details, balance, required: fare, shortfall: balance === null ? null : Math.round((fare - balance) * 100) / 100 };
      } else if (httpErr.code === 'ACTIVE_TRIP_EXISTS') {
        const { rows } = await pg.query(
          `${TRIP_SELECT} WHERE t.rider_id = $1 AND t.status IN ('REQUESTED','IN_TRANSIT')`, [riderId],
        );
        httpErr.details = { ...httpErr.details, active_trip: withTransitions(rows[0] ?? null) };
      }
      throw httpErr;
    }
  });

  // POST /api/trips/:id/status { status } -> CALL sp_update_trip_status
  router.post('/api/trips/:id/status', async ({ params, body }) => {
    const id = requireUuid(params.id, 'tripId');
    const status = body.status;
    if (!TRIP_STATUSES.includes(status)) {
      throw new HttpError(400, 'INVALID_STATUS', `status must be one of ${TRIP_STATUSES.join(', ')}.`);
    }
    return pg.withTransaction(async (client) => {
      const call = await client.query(`CALL sp_update_trip_status($1, $2, NULL)`, [id, status]);
      const [trip, audit] = await Promise.all([
        client.query(`${TRIP_SELECT} WHERE t.id = $1`, [id]),
        client.query(AUDIT_FOR_TRIP, [id]),
      ]);
      const balance = await client.query(`SELECT wallet_balance FROM riders WHERE id = $1`, [trip.rows[0].rider_id]);
      return {
        previous_status: call.rows[0].p_old_status,
        trip: withTransitions(trip.rows[0]),
        audit_entries: audit.rows,
        rider_balance: balance.rows[0].wallet_balance,
      };
    });
  });
}
