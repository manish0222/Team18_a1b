// Workflow 1 through the HTTP API: the transaction form's success and failure
// cases. The database is faked; what we test is that the API
//   - wraps CALL sp_book_trip_atomic in one transaction,
//   - returns balance before/after and the trigger's audit row on success,
//   - turns each database failure into a specific, friendly error with the
//     context the UI needs (shortfall, the blocking active trip, ...),
//   - rejects bad input before touching the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, fakePg, pgError, unusedMongo } from './helpers.js';

const RIDER = '11111111-1111-4111-8111-111111111111';
const VEHICLE = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
const ACTIVE_TRIP = '44444444-4444-4444-8444-444444444444';

const tripRow = (id, status = 'REQUESTED') => ({
  id, rider_id: RIDER, rider_name: 'Test Rider', vehicle_id: VEHICLE, license_plate: 'TS-1234-AB',
  vehicle_class: 'Standard', fare_amount: 30, status, created_at: '2026-10-12T10:00:00Z', completed_at: null,
});

test('successful booking returns balance before/after and the audit row written by the trigger', async () => {
  let balance = 100;
  const pg = fakePg([
    [/SELECT wallet_balance FROM riders WHERE id = \$1 FOR UPDATE/, () => [{ wallet_balance: balance }]],
    [/CALL sp_book_trip_atomic/, ([, , fare]) => { balance -= fare; return [{ p_trip_id: TRIP }]; }],
    [/SELECT wallet_balance FROM riders WHERE id = \$1$/, () => [{ wallet_balance: balance }]],
    [/FROM wallet_audit_logs WHERE reference_trip_id/, () => [{
      id: 'a1', action_type: 'TRIP_ESCROW_DEBIT', amount_changed: -30, balance_before: 100, balance_after: 70,
      reference_trip_id: TRIP, logged_at: '2026-10-12T10:00:00Z',
    }]],
    [/FROM trips t JOIN riders r .* WHERE t.id = \$1/, () => [tripRow(TRIP)]],
  ]);
  const api = await startTestServer({ pg, mongo: unusedMongo });
  try {
    const res = await api.post('/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: '30' });
    assert.equal(res.status, 201);
    assert.equal(res.body.balance_before, 100);
    assert.equal(res.body.balance_after, 70);
    assert.equal(res.body.trip.id, TRIP);
    assert.deepEqual(res.body.trip.allowed_transitions, ['IN_TRANSIT', 'CANCELLED']);
    assert.equal(res.body.audit_entries.length, 1);
    assert.equal(res.body.audit_entries[0].action_type, 'TRIP_ESCROW_DEBIT');

    const sqls = pg.calls.map((c) => c.sql);
    assert.equal(sqls[0], 'BEGIN');
    assert.ok(sqls.includes('COMMIT'), 'transaction committed');
    const call = pg.calls.find((c) => c.sql.startsWith('CALL sp_book_trip_atomic'));
    assert.deepEqual(call.params, [RIDER, VEHICLE, 30], 'fare is sent as a 2-decimal number');
  } finally {
    await api.close();
  }
});

test('insufficient balance -> 409 INSUFFICIENT_BALANCE with balance, required and shortfall', async () => {
  const pg = fakePg([
    [/FOR UPDATE/, () => [{ wallet_balance: 22.92 }]],
    [/CALL sp_book_trip_atomic/, () => {
      throw pgError('RS001', 'Insufficient balance: current 22.92, required 999.00');
    }],
    [/SELECT wallet_balance FROM riders WHERE id = \$1$/, () => [{ wallet_balance: 22.92 }]],
  ]);
  const api = await startTestServer({ pg, mongo: unusedMongo });
  try {
    const res = await api.post('/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 999 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
    assert.equal(res.body.error.details.balance, 22.92);
    assert.equal(res.body.error.details.required, 999);
    assert.equal(res.body.error.details.shortfall, 976.08);
    assert.match(res.body.error.details.dbMessage, /Insufficient balance/);
    assert.ok(pg.calls.some((c) => c.sql === 'ROLLBACK'), 'transaction rolled back');
  } finally {
    await api.close();
  }
});

test('second active trip -> 409 ACTIVE_TRIP_EXISTS including the blocking trip', async () => {
  const pg = fakePg([
    [/FOR UPDATE/, () => [{ wallet_balance: 200 }]],
    [/CALL sp_book_trip_atomic/, () => {
      throw pgError('23505', 'duplicate key value violates unique constraint "idx_active_rider_trip"', {
        constraint: 'idx_active_rider_trip',
      });
    }],
    [/WHERE t.rider_id = \$1 AND t.status IN/, () => [tripRow(ACTIVE_TRIP, 'IN_TRANSIT')]],
  ]);
  const api = await startTestServer({ pg, mongo: unusedMongo });
  try {
    const res = await api.post('/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 10 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ACTIVE_TRIP_EXISTS');
    assert.equal(res.body.error.details.constraint, 'idx_active_rider_trip');
    assert.equal(res.body.error.details.active_trip.id, ACTIVE_TRIP);
    assert.deepEqual(res.body.error.details.active_trip.allowed_transitions, ['COMPLETED', 'CANCELLED']);
  } finally {
    await api.close();
  }
});

test('inactive vehicle and invalid fare map to their own codes', async () => {
  const cases = [
    ['RS002', 'Vehicle x is inactive or does not exist.', 409, 'VEHICLE_UNAVAILABLE'],
    ['RS004', 'Fare must be greater than zero (got 0.00).', 400, 'INVALID_FARE'],
    ['RS003', 'Rider x does not exist.', 404, 'RIDER_NOT_FOUND'],
  ];
  for (const [sqlState, msg, status, code] of cases) {
    const pg = fakePg([
      [/FOR UPDATE/, () => [{ wallet_balance: 50 }]],
      [/CALL sp_book_trip_atomic/, () => { throw pgError(sqlState, msg); }],
    ]);
    const api = await startTestServer({ pg, mongo: unusedMongo });
    try {
      const res = await api.post('/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 5 });
      assert.equal(res.status, status, `${sqlState} status`);
      assert.equal(res.body.error.code, code);
    } finally {
      await api.close();
    }
  }
});

test('malformed input is rejected with 400 before any SQL runs', async () => {
  const pg = fakePg([]);
  const api = await startTestServer({ pg, mongo: unusedMongo });
  try {
    const badRider = await api.post('/api/trips', { riderId: 'not-a-uuid', vehicleId: VEHICLE, fare: 10 });
    assert.equal(badRider.status, 400);
    assert.equal(badRider.body.error.code, 'INVALID_ID');

    const badFare = await api.post('/api/trips', { riderId: RIDER, vehicleId: VEHICLE, fare: 'ten' });
    assert.equal(badFare.status, 400);
    assert.equal(badFare.body.error.code, 'INVALID_AMOUNT');

    assert.equal(pg.calls.length, 0, 'database never touched');
  } finally {
    await api.close();
  }
});

test('status change: invalid transition -> 409, valid one returns new state and refund audit', async () => {
  const pg = fakePg([
    [/CALL sp_update_trip_status/, ([, status]) => {
      if (status === 'COMPLETED') throw pgError('RS005', 'A trip cannot move from REQUESTED to COMPLETED.');
      return [{ p_old_status: 'REQUESTED' }];
    }],
    [/FROM trips t JOIN riders r .* WHERE t.id = \$1/, () => [tripRow(TRIP, 'CANCELLED')]],
    [/FROM wallet_audit_logs WHERE reference_trip_id/, () => [
      { action_type: 'TRIP_ESCROW_DEBIT', amount_changed: -30 },
      { action_type: 'TRIP_REFUND', amount_changed: 30 },
    ]],
    [/SELECT wallet_balance FROM riders/, () => [{ wallet_balance: 100 }]],
  ]);
  const api = await startTestServer({ pg, mongo: unusedMongo });
  try {
    const bad = await api.post(`/api/trips/${TRIP}/status`, { status: 'COMPLETED' });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.error.code, 'INVALID_STATUS_TRANSITION');

    const ok = await api.post(`/api/trips/${TRIP}/status`, { status: 'CANCELLED' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.previous_status, 'REQUESTED');
    assert.equal(ok.body.trip.status, 'CANCELLED');
    assert.deepEqual(ok.body.trip.allowed_transitions, []);
    assert.equal(ok.body.audit_entries.at(-1).action_type, 'TRIP_REFUND');

    const junk = await api.post(`/api/trips/${TRIP}/status`, { status: 'FLYING' });
    assert.equal(junk.status, 400);
  } finally {
    await api.close();
  }
});
