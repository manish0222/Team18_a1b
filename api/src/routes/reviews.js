// Workflow 4 ($facet review analytics), review list, VehicleMetadata catalog.
import { HttpError, requireUuid, optionalUuid, parsePagination, pageResult, optionalDate } from '../http.js';
import { VEHICLE_CLASSES } from './vehicles.js';

/** The Assignment 1 $facet (mongo/03_workflow4_facet.js), optionally preceded by a $match. */
export function buildFacetPipeline(match = {}) {
  const pipeline = [];
  if (Object.keys(match).length) pipeline.push({ $match: match });
  pipeline.push({
    $facet: {
      rating_distribution: [
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $project: { _id: 0, stars: '$_id', count: 1 } },
        { $sort: { stars: -1 } },
      ],
      top_feedback_tags: [
        { $unwind: '$feedback_tags' },
        { $group: { _id: '$feedback_tags', tag_count: { $sum: 1 } } },
        { $project: { _id: 0, tag: '$_id', tag_count: 1 } },
        { $sort: { tag_count: -1 } },
        { $limit: 10 },
      ],
      overall_summary: [
        {
          $group: {
            _id: null,
            total_reviews: { $sum: 1 },
            average_rating: { $avg: '$rating' },
            std_dev_rating: { $stdDevPop: '$rating' },
          },
        },
        {
          $project: {
            _id: 0,
            total_reviews: 1,
            average_rating: { $round: ['$average_rating', 2] },
            std_dev_rating: { $round: ['$std_dev_rating', 2] },
          },
        },
      ],
    },
  });
  return pipeline;
}

function reviewMatch(query) {
  const match = {};
  const vehicleId = optionalUuid(query.vehicleId, 'vehicleId');
  if (vehicleId) match.vehicle_id = vehicleId;
  const from = optionalDate(query.from, 'from');
  const to = optionalDate(query.to, 'to');
  if (from || to) {
    match.created_at = {};
    if (from) match.created_at.$gte = from;
    if (to) match.created_at.$lt = to;
  }
  return match;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function registerReviews(router, { pg, mongo }) {
  // GET /api/reviews/analytics?vehicleId=&from=&to=
  router.get('/api/reviews/analytics', async ({ query }) => {
    const started = Date.now();
    const [facet] = await mongo.collection('TripReviews').aggregate(buildFacetPipeline(reviewMatch(query))).toArray();
    const query_ms = Date.now() - started;

    // Always return all five star buckets so the chart has a stable shape.
    const counts = new Map((facet?.rating_distribution ?? []).map((r) => [r.stars, r.count]));
    const rating_distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: counts.get(stars) ?? 0 }));
    return {
      rating_distribution,
      top_feedback_tags: facet?.top_feedback_tags ?? [],
      overall_summary: facet?.overall_summary?.[0] ?? { total_reviews: 0, average_rating: null, std_dev_rating: null },
      query_ms,
    };
  });

  // GET /api/reviews?vehicleId=&rating=&tag=&from=&to=&page=&pageSize=
  router.get('/api/reviews', async ({ query }) => {
    const pageOpts = parsePagination(query, { defaultSize: 10, maxSize: 50 });
    const filter = reviewMatch(query);
    const rating = Number(query.rating);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) filter.rating = rating;
    if (query.tag) filter.feedback_tags = String(query.tag);

    const col = mongo.collection('TripReviews');
    const [items, total] = await Promise.all([
      col.find(filter, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .skip(pageOpts.offset)
        .limit(pageOpts.limit)
        .toArray(),
      col.countDocuments(filter),
    ]);

    const ids = [...new Set(items.map((r) => r.vehicle_id))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const plates = new Map();
    if (ids.length) {
      const { rows } = await pg.query(`SELECT id, license_plate, class FROM vehicles WHERE id = ANY($1::uuid[])`, [ids]);
      rows.forEach((v) => plates.set(v.id, v));
    }
    return pageResult(items.map((r) => ({ ...r, vehicle: plates.get(r.vehicle_id) ?? null })), total, pageOpts);
  });

  // GET /api/catalog/vehicles?q=&class=&feature=&page=&pageSize=   (VehicleMetadata)
  router.get('/api/catalog/vehicles', async ({ query }) => {
    const pageOpts = parsePagination(query, { defaultSize: 12, maxSize: 50 });
    const filter = {};
    const q = (query.q ?? '').trim();
    if (q) filter.license_plate = { $regex: escapeRegex(q), $options: 'i' };
    if (VEHICLE_CLASSES.includes(query.class)) filter.class = query.class;
    const FEATURES = ['has_child_seat', 'wheelchair_accessible', 'pet_friendly', 'dashcam_enabled'];
    if (FEATURES.includes(query.feature)) filter[`features.${query.feature}`] = true;

    const col = mongo.collection('VehicleMetadata');
    const [items, total] = await Promise.all([
      col.find(filter, {
        projection: {
          _id: 0, vehicle_id: 1, license_plate: 1, class: 1, features: 1, updated_at: 1,
          inspection_count: { $size: '$inspection_records' },
        },
      }).sort({ license_plate: 1 }).skip(pageOpts.offset).limit(pageOpts.limit).toArray(),
      col.countDocuments(filter),
    ]);
    return pageResult(items, total, pageOpts);
  });

  // GET /api/catalog/vehicles/:vehicleId  - full flexible document
  router.get('/api/catalog/vehicles/:vehicleId', async ({ params }) => {
    const vehicleId = requireUuid(params.vehicleId, 'vehicleId');
    const doc = await mongo.collection('VehicleMetadata').findOne({ vehicle_id: vehicleId }, { projection: { _id: 0 } });
    if (!doc) throw new HttpError(404, 'CATALOG_NOT_FOUND', 'No VehicleMetadata document for this vehicle.');
    return doc;
  });
}
