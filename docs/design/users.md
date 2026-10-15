# Who uses RideSync, and what they need

RideSync has two kinds of users. A third, the examiner, shapes some choices but isn't a real user.

## 1. Rider ("Ananya, commutes daily in HITEC City")

A rider books rides and pays from a prepaid wallet.

| Wants to… | Screen | Backed by |
|---|---|---|
| Book a trip with a chosen car and fare, and see what it cost | **Book a trip** | `sp_book_trip_atomic` |
| Understand why a booking failed and fix it on the spot (top up, or finish the trip already running) | **Book a trip** (failure panel) | RS001 / `idx_active_rider_trip` |
| Check that every rupee taken or refunded is accounted for | **Wallet & audit trail** | `wallet_audit_logs`, `fn_rider_audit_trail` |
| Top up the wallet | Wallet, Book (failure panel) | `sp_topup_wallet` |
| Follow or cancel the current trip | Trip detail, Rider detail | `sp_update_trip_status` |

What matters to riders: plain words ("Not enough money in the wallet", not "P0001"), the balance before and after in large type, and one obvious next step.

## 2. Operations team ("Ravi, dispatcher" and "Meera, fleet & quality manager")

Ravi watches supply in real time. Meera looks at revenue and service quality over weeks.

| Wants to… | Screen | Backed by |
|---|---|---|
| See which available cars are closest to a pickup point, live | **Live map** | `$geoNear` on `TelemetryPings` |
| Send a nearby car straight to a booking | Live map → "Book" | links to Workflow 1 |
| Compare vehicles' recent earnings and spot today's top performers | **Fleet analytics** | window functions, `DENSE_RANK()` |
| Read lifetime totals and know how fresh they are, and refresh them | **Fleet analytics** (snapshot panel) | `mv_vehicle_lifetime_earnings` |
| Know how riders rate trips and what they complain about | **Reviews & catalog** | `$facet` on `TripReviews` |
| Check a car's features and inspection history | **Reviews & catalog**, Vehicle detail | `VehicleMetadata` |
| Look up any rider, vehicle or trip | **Riders / Vehicles / Trips** | paginated SQL |

What matters to operations: dense tables that page on the server, filters kept in the URL (so a link can be shared), data that refreshes without reloading, and numbers that say when they were computed.

## 3. Examiner / demo presenter

The examiner needs to switch quickly between riders, trigger each failure on purpose, and see that the database did the work. So:

- **"Acting as"** in the sidebar switches the rider. There's no login; the choice is remembered in the browser.
- **"More than the balance"** is a fare shortcut that triggers the insufficient-balance path in one click.
- Every failure has a collapsible **"What the database said"** that shows the raw SQLSTATE and message.
- The success panel shows the new audit row and states that the **trigger** wrote it, not the app.
