#!/usr/bin/env bash
# Build and seed both databases in the right order (Linux/macOS/Git Bash, and the Docker "seed" service).
#   bash scripts/setup_db.sh            # skips seeding if data already exists
#   RESEED=1 bash scripts/setup_db.sh   # drop and rebuild everything
# Requires: psql, python3 with data_generation/requirements.txt installed.
# MongoDB indexes must exist first: mongosh ridesync_db mongo/01_collections_and_indexes.js
set -euo pipefail
cd "$(dirname "$0")/.."

# load .env if present (values already in the environment win)
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" =~ ^# ]] && continue
    [ -z "${!k:-}" ] && export "$k=$v"
  done < .env
fi
export POSTGRES_HOST=${POSTGRES_HOST:-localhost} POSTGRES_PORT=${POSTGRES_PORT:-5432}
export POSTGRES_DB=${POSTGRES_DB:-ridesync_db} POSTGRES_USER=${POSTGRES_USER:-postgres}
export PGPASSWORD=${POSTGRES_PASSWORD:-postgres}
PSQL="psql -X -q -v ON_ERROR_STOP=1 -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB"
PY=${PYTHON:-python3}

existing=$($PSQL -At -c "SELECT CASE WHEN to_regclass('public.riders') IS NULL THEN 0 ELSE (SELECT count(*) FROM riders) END" 2>/dev/null || echo 0)
if [ "${RESEED:-0}" != "1" ] && [ "${existing:-0}" -gt 0 ]; then
  echo "Database already seeded ($existing riders). Re-applying idempotent support objects only."
  $PSQL -f sql/03_triggers_and_audit.sql -f sql/04_stored_procedures.sql -f sql/07_frontend_support.sql
  exit 0
fi

echo "==> PostgreSQL schema (01-05, 07)"
for f in sql/01_schema_ddl.sql sql/02_indexes.sql sql/03_triggers_and_audit.sql sql/04_stored_procedures.sql sql/05_materialized_views.sql sql/07_frontend_support.sql; do
  echo "    $f"; $PSQL -f "$f" 2>&1 | grep -v NOTICE || true
done

echo "==> Seeding PostgreSQL (10k riders, 2.5k vehicles, 100k trips)"
$PY data_generation/postgres_seeder.py

echo "==> Seeding MongoDB (500k pings, 50k reviews, vehicle metadata)"
$PY data_generation/mongo_seeder.py

echo "==> Back-filling wallet ledger + refreshing materialized view"
$PSQL -f sql/08_seed_audit_history.sql
$PSQL -f sql/09_localize_india.sql >/dev/null
$PY data_generation/sync_vehicle_plates.py
$PSQL -c "REFRESH MATERIALIZED VIEW mv_vehicle_lifetime_earnings;"

echo "==> Database tests"
$PSQL -f sql/tests/test_workflows.sql 2>&1 | grep -E "PASS|passed|ERROR" || true
echo "Done."
