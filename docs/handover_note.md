# Handover note — inherited RideSync (Assignment 1 → 1B)

**Inherited repo:** `Neelesh-Srivastava435/2026201031_a1` (commit `5034eab`), project P2 RideSync.
**Stack we received:** PostgreSQL (riders, vehicles, trips, wallet_audit_logs, one procedure, one trigger, one materialized view, a window-function query) and MongoDB (TelemetryPings with 2dsphere + 2-hour TTL, TripReviews, VehicleMetadata), plus two Python seeders.

## What worked

- `sql/01`–`05` ran in order on PostgreSQL 16 without errors. The schema is small and clear, and the constraints are good: `wallet_balance >= 0` is a CHECK constraint, and status values are CHECKed too.
- `sp_book_trip_atomic` is correct. It checks the vehicle, locks the rider row (`FOR UPDATE`), debits the wallet and inserts the trip. A second active trip is rejected by `idx_active_rider_trip` (SQLSTATE 23505) and the debit is rolled back with it.
- The trigger writes a correct `balance_before` / `balance_after` / `amount_changed` row for every balance change.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` works (the view has the required unique index).
- The window query in `06_window_analytics.sql` gives the documented result: 7-row moving average per vehicle, then `DENSE_RANK()` per day. It takes about 0.3 s on 100k trips.
- The README explains the design decisions well, which made the handover easy.

## What did not work, or got in the way of a UI

| # | Problem | Effect |
|---|---|---|
| 1 | The trigger sets `NEW.updated_at` inside an **AFTER** trigger, where changes to `NEW` are ignored. | `riders.updated_at` never changes. |
| 2 | The seeder inserts riders and trips directly, so the trigger never fires during seeding. | `wallet_audit_logs` is **empty** after seeding, so there is no audit trail to show. |
| 3 | `sp_book_trip_atomic` accepts a fare of `0.00`. A negative fare credits the wallet first and is only stopped later by the `trips` CHECK constraint. | A zero-fare booking creates an active trip with no audit row. |
| 4 | Every failure is raised as the generic `P0001` with an English message. | The API would have to parse message text to tell the user what went wrong. |
| 5 | There is no way to move a trip from REQUESTED/IN_TRANSIT to COMPLETED/CANCELLED, and no top-up. | The partial unique index cannot be demonstrated twice, and an "insufficient balance" rider is stuck. |
| 6 | `mongo_seeder.py` gives every ping and review a fresh random `uuid4()` for `vehicle_id` / `trip_id` / `rider_id`. | Nothing in MongoDB joins back to PostgreSQL, so a map dot or review cannot say which car it is. |
| 7 | Seeded pings expire after 2 hours (the TTL index). | The map is empty two hours after seeding. |
| 8 | `mongo/*.js` start with `const db = db.getSiblingDB(...)`, which reads `db` before the new `const` is initialised. | `ReferenceError: Cannot access 'db' before initialization` under standard JS rules. |
| 9 | The only index on `trips.rider_id` is the partial (active-only) one. | "Show this rider's trips" was a sequential scan of 100k rows. |
| 10 | The audit timestamp used `CURRENT_TIMESTAMP`, which is frozen at transaction start. | Two balance changes in one transaction get the same time, so their order is unclear. |
| 11 | The README mentions a `requirements.md` that is not in the repo and skips `createdb`. | Minor setup friction. |

## What we changed and why

Every change is marked `[A1B]` in the file. The original procedure signature and the README example still work.

- **`sql/01`** adds `wallet_audit_logs.reference_trip_id`, so an audit row can point at the booking that caused it.
- **`sql/02`** adds `idx_trips_rider_created` (fixes #9) and a partial index on `reference_trip_id`.
- **`sql/03`** has three trigger fixes. A separate BEFORE trigger now maintains `updated_at` (#1). The audit trigger reads an optional reason and trip id from transaction-local settings, so it can write `TRIP_ESCROW_DEBIT` / `TRIP_REFUND` / `TOPUP`, and falls back to the original generic labels otherwise. Timestamps now use `clock_timestamp()` (#10).
- **`sql/04`** rejects a fare that is not greater than 0 (#3). It raises distinct SQLSTATEs: `RS001` insufficient balance, `RS002` vehicle unavailable, `RS003` rider missing, `RS004` invalid fare (#4). It also links the debit to the new trip id.
- **`sql/07_frontend_support.sql`** (new):
  - `sp_update_trip_status` handles the trip life-cycle, with a refund on cancel (#5).
  - `sp_topup_wallet` adds money to a wallet (#5).
  - `fn_rider_audit_trail` returns the ledger with a running balance recomputed by a window function and checked against `balance_after`.
  - Two views split the Part A analytics query at its CTE boundary, so the API filters it instead of copying SQL.
- **`sql/08_seed_audit_history.sql`** (new) back-fills a consistent ledger for every seeded rider. It works backwards from the current balance, so no balance is ever negative and the last row equals `wallet_balance` (#2).
- **`sql/09_localize_india.sql`** + **`sync_vehicle_plates.py`** (new) replace the US-locale names and plates with Indian ones, matching the Hyderabad setting. `postgres_seeder.py` now uses `Faker('en_IN')`.
- **`mongo_seeder.py`** now uses real PostgreSQL ids, gives each vehicle a plausible track, clears collections before re-seeding, and never dates a review in the future (#6).
- **`mongo/*.js`**: `const db = …` became `db = …` (#8).
- **API telemetry simulator** (`api/src/services/telemetrySimulator.js`) inserts fresh pings every 5 s for real vehicles, so the map never goes empty and new pings appear live (#7). It can be switched off with `SIMULATE_TELEMETRY=false`.
- **`sql/tests/test_workflows.sql`** (new) holds 9 database tests run in a rolled-back transaction.

## Suggestions for the original authors

1. Fire the audit trigger during seeding (or back-fill the ledger) so the audit feature has data to show.
2. Use a BEFORE trigger for anything that modifies `NEW`, and add a test that checks it.
3. Give each business error its own SQLSTATE so callers don't parse messages.
4. Seed MongoDB with ids taken from PostgreSQL. A polyglot design only pays off when the two stores can be joined.
5. Remember that a TTL index also deletes your demo data. Ship a ping generator, or seed relative to "now" at startup.
6. Validate inputs inside procedures (fare > 0) rather than relying on a later constraint to undo a wrong write.
7. Add the MongoDB `$jsonSchema` validators from `docs/mongo_schema_map.json` to `01_collections_and_indexes.js`. They are documented but never applied.

## Verification status

Checked by us (fill in names/dates):

- [x] PostgreSQL 16: `sql/01`–`08` load cleanly, `sql/tests/test_workflows.sql` passes 9/9, API integration test passes 6/6, Playwright E2E passes 5/5.
- [ ] `python data_generation/postgres_seeder.py` on our machines
- [ ] `python data_generation/mongo_seeder.py` against MongoDB 7 (with the changes above)
- [ ] `mongosh ridesync_db mongo/01_collections_and_indexes.js` (and 02, 03) run without errors
