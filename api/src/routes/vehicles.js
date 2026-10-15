// Vehicles: browse + detail. Detail combines PostgreSQL (vehicle, lifetime
// earnings from the materialized view, recent trips) with MongoDB
// (VehicleMetadata catalog document, review summary).
import { HttpError, requireUuid, parsePagination, pageResult, oneOf } from '../http.js';
import { TRIP_SELECT } from './trips.js';

export const VEHICLE_CLASSES = ['Standard', 'Comfort', 'XL', 'Executive', 'Black'];

const VEHICLE_SORTS = {
  plate: 'v.license_plate ASC',
  earnings_desc: 'COALESCE(mv.total_earnings, 0) DESC, v.license_plate',
  trips_desc: 'COALESCE(mv.lifetime_trip_count, 0) DESC, v.license_plate',
};

export function registerVehicles(router, { pg, mongo }) {
  // GET /api/vehicles?q=&class=&active=true|false&sort=&page=&pageSize=
  router.get('/api/vehicles', async ({ query }) => {
    const pageOpts = parsePagination(query);
    const conds = [];
    const params = [];
    const q = (query.q ?? '').trim();
    if (q) { params.push(`%${q}%`, q.toLowerCase()); conds.push(`(v.license_plate ILIKE $1 OR v.id::text = $2)`); }
    if (VEHICLE_CLASSES.includes(query.class)) { params.push(query.class); conds.push(`v.class = $${params.length}`); }
    if (query.active === 'true' || query.active === 'false') {
      params.push(query.active === 'true'); conds.push(`v.is_active = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sort = VEHICLE_SORTS[oneOf(query.sort, Object.keys(VEHICLE_SORTS), 'plate')];

    const [list, count] = await Promise.all([
      pg.query(
        `SELECT v.id, v.license_plate, v.class, v.is_active, v.created_at,
                mv.lifetime_trip_count, mv.total_earnings
         FROM vehicles v
         LEFT JOIN mv_vehicle_lifetime_earnings mv ON mv.vehicle_id = v.id
         ${where} ORDER BY ${sort} LIMIT ${pageOpts.limit} OFFSET ${pageOpts.offset}`,
        params,
      ),
      pg.query(`SELECT COUNT(*)::bigint AS total FROM vehicles v ${where}`, params),
    ]);
    return pageResult(list.rows, count.rows[0].total, pageOpts);
  });

  // GET /api/vehicles/:id
  router.get('/api/vehicles/:id', async ({ params }) => {
    const id = requireUuid(params.id, 'vehicleId');
    const { rows } = await pg.query(
      `SELECT v.id, v.license_plate, v.class, v.is_active, v.created_at,
              mv.lifetime_trip_count, mv.total_earnings, mv.avg_fare_per_trip, mv.last_trip_at,
              mv.last_refreshed_at
       FROM vehicles v
       LEFT JOIN mv_vehicle_lifetime_earnings mv ON mv.vehicle_id = v.id
       WHERE v.id = $1`,
      [id],
    );
    if (!rows.length) throw new HttpError(404, 'VEHICLE_NOT_FOUND', 'That vehicle does not exist.');

    const recent = await pg.query(`${TRIP_SELECT} WHERE t.vehicle_id = $1 ORDER BY t.created_at DESC LIMIT 10`, [id]);

    let metadata = null;
    let reviews = null;
    let mongo_error = null;
    try {
      [metadata, reviews] = await Promise.all([
        mongo.collection('VehicleMetadata').findOne({ vehicle_id: id }, { projection: { _id: 0 } }),
        mongo.collection('TripReviews').aggregate([
          { $match: { vehicle_id: id } },
          { $group: { _id: null, count: { $sum: 1 }, average_rating: { $avg: '$rating' } } },
          { $project: { _id: 0, count: 1, average_rating: { $round: ['$average_rating', 2] } } },
        ]).toArray().then((r) => r[0] ?? { count: 0, average_rating: null }),
      ]);
    } catch {
      mongo_error = 'Catalog and reviews are unavailable right now (MongoDB not reachable).';
    }

    return { ...rows[0], recent_trips: recent.rows, metadata, reviews, mongo_error };
  });
}
