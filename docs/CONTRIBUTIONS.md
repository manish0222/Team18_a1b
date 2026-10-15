# Team 18 — Contribution breakdown

Per-file split of what each team member built for Assignment 1B. The same files are visible as separate commits on the [GitHub repository](https://github.com/manish0222/Team18_a1b/commits/main).

## Manish Godbole — 2026201064
**Role:** API core, database fixes, delivery automation

**Code**
- `api/src/routes/riders.js`, `trips.js`
- `api/Dockerfile`
- `scripts/bootstrap.sh`, `bootstrap-ubuntu.sh`, `bootstrap-windows.ps1`
- `docker-compose.yml`, `docker-compose.images.yml`
- `mongo/Dockerfile.init`

**Database**
- README rewrite for A1B
- `sql/07_frontend_support.sql` — `sp_update_trip_status`, `sp_topup_wallet`, `fn_rider_audit_trail`, analytics views
- `sql/08_seed_audit_history.sql` — ledger back-fill
- `sql/09_localize_india.sql` — Indian names + plates
- `sql/tests/test_workflows.sql` — 9 DB tests
- `data_generation/Dockerfile`, `sync_vehicle_plates.py`

## Greeshman Trivedi — 2026204013
**Role:** Database-access routes, core library hooks

**Code**
- `api/src/app.js`, `server.js`, `config.js`, `router.js`, `http.js`, `errors.js`
- `api/src/db/postgres.js`, `mongo.js`
- `api/src/routes/analytics.js`, `map.js`, `reviews.js`
- `web/src/pages/Riders.tsx`, `Vehicles.tsx`
- `web/src/components/VehicleCatalogCard.tsx`
- `web/src/lib/api.ts`, `useApi.ts`
- `web/src/types.ts`
- `web/src/styles/app.css`
- `scripts/setup_db.ps1`, `check_prereqs.ps1`
- Package manifests: `api/package.json`, `web/package.json` + lockfiles

## Sai Harshith Yekoji — 2026201017
**Role:** Telemetry, infrastructure, dockerisation

**Code**
- `api/src/routes/health.js`, `vehicles.js`
- `api/src/services/telemetrySimulator.js`
- `api/integration/workflows.integration.js`
- `api/test/helpers.js`
- `web/Dockerfile`, `index.html`, `nginx.conf`, `public/favicon.svg`
- `web/src/components/AuditTable.tsx`, `icons.tsx`
- `web/src/lib/actor.tsx`, `toast.tsx`
- `web/src/pages/Overview.tsx`, `Trips.tsx`
- `scripts/bootstrap-macos.sh`, `setup_db.sh`

## Palaksh Ghildiyal — 2026204015
**Role:** Front-end UI, tests, documentation

**Code**
- `web/src/pages/Analytics.tsx`, `BookRide.tsx`, `Reviews.tsx`, `Wallet.tsx`
- `web/src/components/TripActions.tsx`, `charts.tsx`
- `web/src/lib/format.ts`
- `web/src/styles/tokens.css`
- `api/test/api.test.js`, `booking.test.js`
- `web/playwright.config.ts`, `web/e2e/booking.spec.ts`

**Documentation**
- `docs/handover_note.md`
- `docs/api_endpoints.md`
- `docs/assignment1_README.md`
- `docs/demo_script.md`
- `docs/design/users.md`, `style_guide.md`
- `docs/design/wireframes/`
- `docs/screenshots/`
