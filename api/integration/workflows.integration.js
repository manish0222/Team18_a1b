// Integration test: real API + real PostgreSQL (seeded ridesync_db).
//   cd api && npm run test:integration
// Creates its own rider + vehicle, exercises Workflow 1 end to end through
// HTTP, and deletes everything it created at the end. MongoDB is not needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createPostgres } from '../src/db/postgres.js';
import { createApp } from '../src/app.js';

const config = loadConfig();
const pg = createPostgres(config.postgres);
const mongoStub = { collection: () => ({ findOne: async () => null }), ping: async () => true };
const RIDER = randomUUID();
const VEHICLE = randomUUID();
let server;
let base;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  await pg.query(`INSERT INTO riders (id, name, email, wallet_balance) VALUES ($1, 'Integration Rider', $2, 50.00)`,
    [RIDER, `it-${RIDER}@a1b.local`]);
  await pg.query(`INSERT INTO vehicles (id, license_plate, class, is_active) VALUES ($1, $2, 'Comfort', TRUE)`,
    [VEHICLE, `IT-${RIDER.slice(0, 8)}`]);
  server = http.createServer(createApp({ pg, mongo: mongoStub, logger: { error() {} } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await pg.query(`DELETE FROM trips WHERE rider_id = $1`, [RIDER]);
  await pg.query(`DELETE FROM riders WHERE id = $1`, [RIDER]); // audit rows cascade
  await pg.query(`DELETE FROM vehicles WHERE id = $1`, [VEHICLE]);
  await new Promise((r) => server.close(r));
  await pg.end();
});

test('Workflow 1 end to end against the real stored procedure and trigger', async (t) => {
  let tripId;

  await t.test('book: 50.00 -> 20.00, audit row from trigger', async () => {
    const res = await call('POST', '/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 30 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.balance_before, 50);
    assert.equal(res.body.balance_after, 20);
    assert.equal(res.body.audit_entries.length, 1);
    assert.equal(res.body.audit_entries[0].action_type, 'TRIP_ESCROW_DEBIT');
    assert.equal(res.body.audit_entries[0].balance_after, 20);
    tripId = res.body.trip.id;
  });

  await t.test('second booking blocked by idx_active_rider_trip', async () => {
    const res = await call('POST', '/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 5 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ACTIVE_TRIP_EXISTS');
    assert.equal(res.body.error.details.active_trip.id, tripId);
  });

  await t.test('move the trip along: REQUESTED -> IN_TRANSIT -> COMPLETED', async () => {
    const skip = await call('POST', `/api/trips/${tripId}/status`, { status: 'COMPLETED' });
    assert.equal(skip.status, 409);
    assert.equal(skip.body.error.code, 'INVALID_STATUS_TRANSITION');
    assert.equal((await call('POST', `/api/trips/${tripId}/status`, { status: 'IN_TRANSIT' })).status, 200);
    const done = await call('POST', `/api/trips/${tripId}/status`, { status: 'COMPLETED' });
    assert.equal(done.status, 200);
    assert.equal(done.body.trip.status, 'COMPLETED');
  });

  await t.test('insufficient balance: 20.00 available, 45.00 requested', async () => {
    const res = await call('POST', '/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 45 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
    assert.equal(res.body.error.details.shortfall, 25);
  });

  await t.test('top up, then the same booking succeeds; cancel refunds', async () => {
    const top = await call('POST', `/api/riders/${RIDER}/topup`, { amount: 40 });
    assert.equal(top.status, 200);
    assert.equal(top.body.balance_after, 60);
    assert.equal(top.body.audit_entry.action_type, 'TOPUP');

    const ok = await call('POST', '/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 45 });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.balance_after, 15);

    const cancel = await call('POST', `/api/trips/${ok.body.trip.id}/status`, { status: 'CANCELLED' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.rider_balance, 60);
    assert.deepEqual(cancel.body.audit_entries.map((a) => a.action_type), ['TRIP_ESCROW_DEBIT', 'TRIP_REFUND']);
  });

  await t.test('audit trail: 4 rows, running balance consistent, ends at wallet balance', async () => {
    const res = await call('GET', `/api/riders/${RIDER}/audit`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 4);
    assert.equal(res.body.summary.all_consistent, true);
    assert.equal(res.body.summary.closing_balance, 60);
    assert.equal(res.body.items[0].action_type, 'TRIP_REFUND', 'newest first');
  });
});
