# Demo script (≤ 5 minutes)

Before recording: run `docker compose up` (or the local steps) and open http://localhost:8080 (Docker) or http://localhost:5173 (dev). Pick a rider in **Acting as** with a balance of about ₹100–300 and no active trip; the Riders page shows "On a trip" for riders who have one.

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | Overview | Show the sidebar groups and the database health panel. | "Two users: a rider and the operations team. Everything runs on the inherited Postgres + Mongo design; the API is a thin layer." |
| 0:20 | Riders → a rider | Search a name, page through, open a rider, click **Act as**. | "Browsing is server-side paginated: 10,000 riders, 25 at a time." |
| 0:40 | **Book a trip** | Pick a vehicle, fare ₹45, **Book trip**. | "One call to `sp_book_trip_atomic`. Balance before and after, and here is the audit row. The **trigger** wrote it, not our code." |
| 1:10 | Book (again) | Click **Book trip** again. | "Second active trip: the partial unique index `idx_active_rider_trip` refuses it, and nothing was charged." Open "What the database said" to show SQLSTATE 23505. |
| 1:30 | Book | In the error panel, click **Cancel and refund**, then **Book trip** again → succeeds. Then **Start trip**, **Complete trip**. | "Status changes go through `sp_update_trip_status`; cancelling refunds through the same trigger." |
| 2:00 | Book | Click **More than the balance**, then **Book trip** → insufficient panel → **Top up ₹50** → book again. | "Insufficient balance is its own error code, RS001. The panel shows the exact shortfall and the fix." |
| 2:30 | **Wallet & audit trail** | Show the ledger, ✓ column, chart; switch period to 7 days. | "Running balance is recomputed in SQL with a window function and checked against what the trigger stored." |
| 3:00 | **Fleet analytics** | Point at the snapshot's "last refreshed" and "N trips completed since refresh". Click **Refresh snapshot**; the numbers update. Show the moving-average chart, then change the day in the DENSE_RANK table and add a vehicle to the chart. | "Summary is the materialized view, refreshed CONCURRENTLY. Chart and ranking are the Assignment 1 window query, live." |
| 3:50 | **Live map** | Switch locality, click the map to move the origin, wait for a poll ("New" tags). Click **Book** on a vehicle. | "`$geoNear` with a 2dsphere index, 5 km. The API keeps sending pings, so new ones appear without reloading." |
| 4:25 | **Reviews & catalog** | Show the three charts, filter by a vehicle, open a catalog card and its raw JSON. | "One `$facet` aggregation feeds all three charts. VehicleMetadata is a flexible document shown as a readable card." |
| 4:50 | — | Resize to phone width (or show the phone screenshot). | "Works on a phone; tables scroll inside their panels." |
