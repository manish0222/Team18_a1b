// Other behaviour the UI depends on: pagination limits, Mongo pipelines,
// graceful degradation when MongoDB is down, routing errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, fakePg, unusedMongo } from './helpers.js';
import { buildNearbyPipeline } from '../src/routes/map.js';
import { buildFacetPipeline } from '../src/routes/reviews.js';
import { Router } from '../src/router.js';

test('rider list never asks the database for more than 100 rows', async () => {
  const pg = fakePg([
    [/COUNT\(\*\)/, () => [{ total: 10000 }]],
    [/FROM riders r/, () => []],
  ]);
  const api = await startTestServer({ pg, mongo: unusedMongo });
  try {
    const res = await api.get('/api/riders?pageSize=100000&page=3&q=sharma');
    assert.equal(res.status, 200);
    assert.equal(res.body.pageSize, 100);
    assert.equal(res.body.totalPages, 100);
    const list = pg.calls.find((c) => /LIMIT/.test(c.sql));
    assert.match(list.sql, /LIMIT 100 OFFSET 200/);
    assert.deepEqual(list.params, ['%sharma%', 'sharma'], 'search text is a bound parameter, not concatenated');
  } finally {
    await api.close();
  }
});

test('nearby pipeline starts with the Part A $geoNear stage (5 km, available only)', () => {
  const since = new Date('2026-10-12T10:00:00Z');
  const p = buildNearbyPipeline({ lng: 78.382, lat: 17.4435, radius: 5000, limit: 10, since });
  assert.deepEqual(Object.keys(p[0]), ['$geoNear']);
  assert.deepEqual(p[0].$geoNear.near, { type: 'Point', coordinates: [78.382, 17.4435] });
  assert.equal(p[0].$geoNear.maxDistance, 5000);
  assert.equal(p[0].$geoNear.spherical, true);
  assert.equal(p[0].$geoNear.query.is_available, true);
  assert.equal(p[0].$geoNear.query.created_at.$gte, since);
  assert.ok(p.some((s) => s.$limit === 10));
});

test('map endpoint validates coordinates and caps the radius at 5 km', async () => {
  const api = await startTestServer({ pg: fakePg([]), mongo: unusedMongo });
  try {
    const noCoords = await api.get('/api/map/nearby');
    assert.equal(noCoords.status, 400);
    const tooFar = await api.get('/api/map/nearby?lng=78.38&lat=17.44&radius=50000');
    assert.equal(tooFar.status, 400);
    assert.match(tooFar.body.error.message, /radius/);
  } finally {
    await api.close();
  }
});

test('$facet pipeline keeps the three Part A facets and adds an optional $match', () => {
  const plain = buildFacetPipeline();
  assert.equal(plain.length, 1);
  assert.deepEqual(Object.keys(plain[0].$facet).sort(), ['overall_summary', 'rating_distribution', 'top_feedback_tags']);
  const filtered = buildFacetPipeline({ vehicle_id: 'x' });
  assert.deepEqual(filtered[0], { $match: { vehicle_id: 'x' } });
});

test('review analytics fills missing star buckets with zero', async () => {
  const mongo = {
    collection: () => ({
      aggregate: () => ({
        toArray: async () => [{
          rating_distribution: [{ stars: 5, count: 7 }, { stars: 1, count: 2 }],
          top_feedback_tags: [{ tag: 'Clean Car', tag_count: 4 }],
          overall_summary: [{ total_reviews: 9, average_rating: 4.11, std_dev_rating: 1.6 }],
        }],
      }),
    }),
  };
  const api = await startTestServer({ pg: fakePg([]), mongo });
  try {
    const res = await api.get('/api/reviews/analytics');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.rating_distribution.map((r) => r.count), [7, 0, 0, 0, 2]);
    assert.equal(res.body.overall_summary.average_rating, 4.11);
  } finally {
    await api.close();
  }
});

test('MongoDB down -> 503 MONGO_UNAVAILABLE (UI shows a message, not a blank page)', async () => {
  const down = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:27017'), { name: 'MongoServerSelectionError' });
  const mongo = { collection: () => ({ aggregate: () => ({ toArray: async () => { throw down; } }) }) };
  const api = await startTestServer({ pg: fakePg([]), mongo });
  try {
    const res = await api.get('/api/reviews/analytics');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'MONGO_UNAVAILABLE');
  } finally {
    await api.close();
  }
});

test('trip detail still works when MongoDB is down (review section degrades)', async () => {
  const TRIP = '33333333-3333-4333-8333-333333333333';
  const pg = fakePg([
    [/WHERE t.id = \$1/, () => [{ id: TRIP, status: 'COMPLETED', rider_id: 'r' }]],
  ]);
  const mongo = { collection: () => ({ findOne: async () => { throw new Error('down'); } }) };
  const api = await startTestServer({ pg, mongo });
  try {
    const res = await api.get(`/api/trips/${TRIP}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.review, null);
    assert.match(res.body.review_error, /unavailable/);
    assert.deepEqual(res.body.allowed_transitions, []);
  } finally {
    await api.close();
  }
});

test('router: params, 404 and 405', async () => {
  const r = new Router().get('/api/things/:id/parts/:part', () => 'x');
  assert.deepEqual(r.match('GET', '/api/things/42/parts/wheel').params, { id: '42', part: 'wheel' });
  assert.equal(r.match('GET', '/api/nothing'), null);
  assert.deepEqual(r.match('POST', '/api/things/1/parts/2'), { methodNotAllowed: true });

  const api = await startTestServer({ pg: fakePg([]), mongo: unusedMongo });
  try {
    assert.equal((await api.get('/api/does-not-exist')).status, 404);
    const r405 = await fetch(`${api.base}/api/riders`, { method: 'POST' });
    assert.equal(r405.status, 405);
  } finally {
    await api.close();
  }
});
