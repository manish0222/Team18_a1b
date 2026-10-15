# RideSync API — endpoint sketch

Base URL: `http://localhost:4000/api` (in development the web app calls `/api/*` and Vite forwards it).
All responses are JSON. Lists are paginated as
`{ items, page, pageSize, total, totalPages }` (`pageSize` is capped at 100, so the browser never loads all rows).

Errors always look like:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Not enough money in the wallet for this trip.",
             "details": { "balance": 22.92, "required": 999, "shortfall": 976.08,
                          "dbMessage": "Insufficient balance: current 22.92, required 999.00", "sqlState": "RS001" } } }
```

| HTTP | code | Raised by |
|---|---|---|
| 400 | `INVALID_ID`, `INVALID_AMOUNT`, `INVALID_DATE`, `INVALID_PARAM`, `INVALID_STATUS` | API input validation (before any SQL) |
| 400 | `INVALID_FARE` (RS004), `INVALID_TOPUP_AMOUNT` (RS006) | stored procedures |
| 404 | `RIDER_NOT_FOUND` (RS003), `TRIP_NOT_FOUND` (RS007), `VEHICLE_NOT_FOUND`, `CATALOG_NOT_FOUND` | procedures / API |
| 409 | `INSUFFICIENT_BALANCE` (RS001) | `sp_book_trip_atomic` |
| 409 | `VEHICLE_UNAVAILABLE` (RS002) | `sp_book_trip_atomic` |
| 409 | `ACTIVE_TRIP_EXISTS` (23505 on `idx_active_rider_trip`) | partial unique index |
| 409 | `INVALID_STATUS_TRANSITION` (RS005) | `sp_update_trip_status` |
| 503 | `POSTGRES_UNAVAILABLE`, `MONGO_UNAVAILABLE` | connection failures |

---

## Health

| Method & path | Input | Output |
|---|---|---|
| `GET /health` | – | `{ postgres:{ok,ms}, mongodb:{ok,ms}, simulator:{running, pings_inserted, last_tick_at}, time }` |

## Browse (PostgreSQL)

| Method & path | Input (query) | Output | SQL used |
|---|---|---|---|
| `GET /riders` | `q` (name/email/id), `sort` = `name`\|`balance_desc`\|`balance_asc`\|`recent`, `page`, `pageSize` | page of `{id, name, email, wallet_balance, updated_at, has_active_trip}` | `riders` + `EXISTS` on partial index |
| `GET /riders/:id` | – | rider + `active_trip` (with `allowed_transitions`) + `stats` + `recent_trips[5]` | `riders`, `trips` (`idx_trips_rider_created`) |
| `GET /vehicles` | `q` (plate/id), `class`, `active`, `sort` = `plate`\|`earnings_desc`\|`trips_desc`, `page` | page of vehicles with lifetime trips/earnings | `vehicles` ⟕ `mv_vehicle_lifetime_earnings` |
| `GET /vehicles/:id` | – | vehicle + MV numbers + `recent_trips[10]` + `metadata` (Mongo) + `reviews {count, average_rating}` (Mongo) + `mongo_error` | PG + Mongo |
| `GET /trips` | `status` (comma list), `riderId`, `vehicleId`, `from`, `to`, `sort` = `recent`\|`oldest`\|`fare_desc`, `page` | page of trips (rider name, plate, class joined) | `trips` ⨝ `riders` ⨝ `vehicles` |
| `GET /trips/:id` | – | trip + `allowed_transitions` + `audit_entries` (wallet rows for this trip) + `review` (Mongo) | |

## Workflow 1 — booking (PostgreSQL)

| Method & path | Input (JSON body) | Output | Database work |
|---|---|---|---|
| `POST /trips` | `{ riderId, vehicleId, fare }` | **201** `{ trip, balance_before, balance_after, audit_entries }` | one transaction: `SELECT … FOR UPDATE` → `CALL sp_book_trip_atomic` → read balance → read `wallet_audit_logs WHERE reference_trip_id` (row written by `trg_audit_wallet_balance`) |
| `POST /trips/:id/status` | `{ status }` = `IN_TRANSIT`\|`COMPLETED`\|`CANCELLED` | `{ previous_status, trip, audit_entries, rider_balance }` | `CALL sp_update_trip_status` (refund on cancel) |
| `POST /riders/:id/topup` | `{ amount }` (0.01–5000) | `{ balance_before, balance_after, audit_entry }` | `CALL sp_topup_wallet` |

Failure details added for the UI:
`INSUFFICIENT_BALANCE → details {balance, required, shortfall}`,
`ACTIVE_TRIP_EXISTS → details {active_trip}` (so the screen can offer "Complete" / "Cancel" right there).

## Audit trail (PostgreSQL)

| Method & path | Input (query) | Output |
|---|---|---|
| `GET /riders/:id/audit` | `from`, `to` (ISO date or datetime; `to` exclusive), `page`, `pageSize` | `{ rider, summary {opening_balance, closing_balance, total_in, total_out, all_consistent}, series [{logged_at, running_balance}], items [{…, running_balance, is_consistent}], …page }` from `fn_rider_audit_trail` |

## Workflow 2 + materialized view (PostgreSQL)

| Method & path | Input | Output | Source |
|---|---|---|---|
| `GET /analytics/summary` | – | totals, `last_refreshed_at`, `trips_since_refresh`, `by_class[]`, `top_vehicles[10]` | `mv_vehicle_lifetime_earnings` (+ live count from `trips`) |
| `POST /analytics/summary/refresh` | – | same as above + `refresh_duration_ms` | `SELECT fn_refresh_vehicle_earnings_mv()` (`REFRESH … CONCURRENTLY`) |
| `GET /analytics/dates` | – | `{ first_date, last_date }` of completed trips | |
| `GET /analytics/ranking` | `date` (default latest), `class`, `page`, `pageSize` | `{ date, items [{rank, plate, class, daily_trips, daily_fare_revenue, seven_day_moving_avg_revenue, daily_performance_rank}] }` | `vw_vehicle_revenue_ranking` (= Part A query, `DENSE_RANK()`) |
| `GET /analytics/vehicles/:id/moving-average` | `from`, `to` (YYYY-MM-DD) | `{ vehicle, points [{trip_date, daily_trips, daily_fare_revenue, seven_day_moving_avg_revenue}] }` | `vw_vehicle_moving_avg` (Part A window, filter pushed into the partition) |

## Workflow 3 — map (MongoDB)

| Method & path | Input (query) | Output |
|---|---|---|
| `GET /map/nearby` | `lng`, `lat` (required), `radius` ≤ 5000 (default 5000), `limit` ≤ 100 (default 20), `windowMinutes` 1–120 (default 15) | `{ origin, radius_meters, window_minutes, generated_at, query_ms, results [{vehicle_id, ping_id, distance_meters, location, speed_kmh, heading_degrees, created_at, pings_in_window, vehicle {plate, class}}] }` |

Pipeline: Part A `$geoNear` (2dsphere, `maxDistance` 5000, `is_available: true`) + `created_at ≥ now − window` → `$sort created_at` → `$group` by vehicle (latest ping) → `$sort distance` → `$limit`. The UI polls this every 5 s.

## Workflow 4 — reviews and catalog (MongoDB)

| Method & path | Input (query) | Output |
|---|---|---|
| `GET /reviews/analytics` | `vehicleId`, `from`, `to` (all optional) | `{ rating_distribution [5..1], top_feedback_tags [10], overall_summary {total_reviews, average_rating, std_dev_rating}, query_ms }` — the Part A `$facet` with an optional leading `$match` |
| `GET /reviews` | `vehicleId`, `rating`, `tag`, `from`, `to`, `page`, `pageSize` ≤ 50 | page of reviews with the vehicle's plate joined from PostgreSQL |
| `GET /catalog/vehicles` | `q` (plate), `class`, `feature` (`has_child_seat`\|`wheelchair_accessible`\|`pet_friendly`\|`dashcam_enabled`), `page` | page of `VehicleMetadata` summaries (+ `inspection_count`) |
| `GET /catalog/vehicles/:vehicleId` | – | the full flexible `VehicleMetadata` document |
