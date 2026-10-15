# Prints what is installed and running, so you know which setup path to use.
#   Terminal > Run Task > "RideSync: 1. Check prerequisites"
function Show($name, $cmd, $cmdArgs) {
  $exe = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($exe) {
    $v = (& $cmd @cmdArgs 2>&1 | Select-Object -First 1)
    Write-Host ("[ OK ] {0,-12} {1}" -f $name, $v) -ForegroundColor Green
    return $true
  } else {
    Write-Host ("[MISS] {0,-12} not found on PATH" -f $name) -ForegroundColor Yellow
    return $false
  }
}
function Port($name, $port) {
  $open = Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($open) { Write-Host ("[ OK ] {0,-12} listening on {1}" -f $name, $port) -ForegroundColor Green }
  else { Write-Host ("[ -- ] {0,-12} nothing listening on {1}" -f $name, $port) -ForegroundColor Yellow }
  return $open
}
Write-Host "`n== Tools" -ForegroundColor Cyan
$node   = Show 'Node.js' 'node' @('-v')
$npm    = Show 'npm' 'npm' @('-v')
$py     = Show 'Python' 'python' @('--version')
$psql   = Show 'psql' 'psql' @('--version')
$mongosh= Show 'mongosh' 'mongosh' @('--version')
$docker = Show 'Docker' 'docker' @('--version')
Write-Host "`n== Services" -ForegroundColor Cyan
$pg = Port 'PostgreSQL' 5432
$mg = Port 'MongoDB' 27017
Write-Host "`n== What to do next" -ForegroundColor Cyan
if ($docker) {
  Write-Host "Docker found: run task 'RideSync: Docker - start everything' (no other installs needed)."
}
if ($node -and $py -and $psql -and $mongosh -and $pg -and $mg) {
  Write-Host "Local path ready: run 'RideSync: 2. Install dependencies', then '3. Set up databases', then 'RideSync: Run app'."
} elseif (-not $docker) {
  if (-not $node) { Write-Host " - Install Node.js 20+ (https://nodejs.org)" }
  if (-not $py)   { Write-Host " - Install Python 3.10+ (https://python.org), tick 'Add to PATH'" }
  if (-not $psql -or -not $pg) { Write-Host " - Install PostgreSQL 16 (https://www.postgresql.org/download/windows/) and add its bin folder to PATH" }
  if (-not $mongosh -or -not $mg) { Write-Host " - Install MongoDB 7 Community Server + mongosh (https://www.mongodb.com/try/download)" }
  Write-Host " - Or install Docker Desktop instead of PostgreSQL/MongoDB."
}
