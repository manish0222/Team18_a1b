// Workflow 3: nearest available vehicles around an origin ($geoNear, 5 km).
import { parseNumberInRange } from '../http.js';

/**
 * Builds the pipeline. Stage 1 is the Assignment 1 $geoNear stage
 * (mongo/02_workflow3_geonear.js) with two additions:
 *   - created_at >= now - windowMinutes, so only *current* positions count
 *     (seeded data links many pings to each real vehicle);
 *   - $sort + $group keeps each vehicle's LATEST ping inside the radius, so a
 *     vehicle appears once instead of once per ping.
 */
export function buildNearbyPipeline({ lng, lat, radius, limit, since }) {
  return [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance_meters',
        maxDistance: radius,
        spherical: true,
        query: { is_available: true, created_at: { $gte: since } },
      },
    },
    { $sort: { created_at: -1 } },
    {
      $group: {
        _id: '$vehicle_id',
        ping_id: { $first: '$ping_id' },
        distance_meters: { $first: '$distance_meters' },
        location: { $first: '$location' },
        speed_kmh: { $first: '$speed_kmh' },
        heading_degrees: { $first: '$heading_degrees' },
        created_at: { $first: '$created_at' },
        pings_in_window: { $sum: 1 },
      },
    },
    { $sort: { distance_meters: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        vehicle_id: '$_id',
        ping_id: 1,
        distance_meters: { $round: ['$distance_meters', 2] },
        location: 1,
        speed_kmh: 1,
        heading_degrees: 1,
        created_at: 1,
        pings_in_window: 1,
      },
    },
  ];
}

export function registerMap(router, { pg, mongo }) {
  // GET /api/map/nearby?lng=&lat=&radius=5000&limit=20&windowMinutes=15
  router.get('/api/map/nearby', async ({ query }) => {
    const lng = parseNumberInRange(query.lng, 'lng', { min: -180, max: 180 });
    const lat = parseNumberInRange(query.lat, 'lat', { min: -90, max: 90 });
    const radius = parseNumberInRange(query.radius, 'radius', { min: 100, max: 5000, fallback: 5000 });
    const limit = Math.floor(parseNumberInRange(query.limit, 'limit', { min: 1, max: 100, fallback: 20 }));
    const windowMinutes = parseNumberInRange(query.windowMinutes, 'windowMinutes', { min: 1, max: 120, fallback: 15 });
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);

    const started = Date.now();
    const results = await mongo
      .collection('TelemetryPings')
      .aggregate(buildNearbyPipeline({ lng, lat, radius, limit, since }))
      .toArray();
    const query_ms = Date.now() - started;

    // Join back to PostgreSQL for plate / class (works because the seeder now
    // uses real vehicle ids).
    const ids = results.map((r) => r.vehicle_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const vehicles = new Map();
    if (ids.length) {
      const { rows } = await pg.query(
        `SELECT id, license_plate, class, is_active FROM vehicles WHERE id = ANY($1::uuid[])`, [ids],
      );
      rows.forEach((v) => vehicles.set(v.id, v));
    }

    return {
      origin: { lng, lat },
      radius_meters: radius,
      window_minutes: windowMinutes,
      generated_at: new Date().toISOString(),
      query_ms,
      results: results.map((r) => ({ ...r, vehicle: vehicles.get(r.vehicle_id) ?? null })),
    };
  });
}
