# Build and seed both databases on Windows (PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\setup_db.ps1
# Requires psql, mongosh and python on PATH, and `pip install -r data_generation\requirements.txt`.
# Reads connection settings from .env in the repo root.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (Test-Path .env) {
  Get-Content .env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    if (-not [Environment]::GetEnvironmentVariable($k.Trim())) { [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim()) }
  }
}
$H = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { 'localhost' }
$P = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
$D = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'ridesync_db' }
$U = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'postgres' }
$env:PGPASSWORD = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'postgres' }
$MongoDb = if ($env:MONGO_DB) { $env:MONGO_DB } else { 'ridesync_db' }

function Invoke-Psql([string[]]$PsqlArgs) {
  & psql -X -q -v ON_ERROR_STOP=1 -h $H -p $P -U $U -d $D @PsqlArgs
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $PsqlArgs" }
}

# create the database if it does not exist
$exists = & psql -X -At -h $H -p $P -U $U -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$D'"
if (-not $exists) { & createdb -h $H -p $P -U $U $D }

Write-Host '==> PostgreSQL schema (01-05, 07)'
foreach ($f in '01_schema_ddl', '02_indexes', '03_triggers_and_audit', '04_stored_procedures', '05_materialized_views', '07_frontend_support') {
  Write-Host "    sql/$f.sql"; Invoke-Psql @('-f', "sql/$f.sql")
}

Write-Host '==> MongoDB collections and indexes'
& mongosh $MongoDb --quiet mongo/01_collections_and_indexes.js
if ($LASTEXITCODE -ne 0) { throw 'mongosh failed' }

Write-Host '==> Seeding PostgreSQL'
& python data_generation/postgres_seeder.py
if ($LASTEXITCODE -ne 0) { throw 'postgres_seeder failed' }
Write-Host '==> Seeding MongoDB'
& python data_generation/mongo_seeder.py
if ($LASTEXITCODE -ne 0) { throw 'mongo_seeder failed' }

Write-Host '==> Back-filling wallet ledger + refreshing materialized view'
Invoke-Psql @('-f', 'sql/08_seed_audit_history.sql')
Invoke-Psql @('-f', 'sql/09_localize_india.sql')
& python data_generation/sync_vehicle_plates.py
Invoke-Psql @('-c', 'REFRESH MATERIALIZED VIEW mv_vehicle_lifetime_earnings;')

Write-Host '==> Database tests'
Invoke-Psql @('-f', 'sql/tests/test_workflows.sql')
Write-Host 'Done.'
