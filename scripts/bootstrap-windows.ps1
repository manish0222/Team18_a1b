# =============================================================================
# RideSync bootstrap — Windows (PowerShell, native, best-effort)
#
# Usage (Admin PowerShell):
#   git clone -b mandemo https://github.com/Palakshghildiyal17/DEMO.git
#   cd DEMO
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\bootstrap-windows.ps1
#
# Requires:
#   - Windows 10 (1809+) or Windows 11
#   - PowerShell 5.1+ (built in) or PowerShell 7
#   - winget (built-in on Win 10+; install from Store if missing)
#   - Git for Windows (provides bash.exe; script uses it to run setup_db.sh)
#
# NOTE: This script is UNTESTED by the authors on a fresh Windows machine.
#       If it fails, use Docker instead:  docker compose up --build
# =============================================================================

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Test-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# --- 0. Sanity --------------------------------------------------------------
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

Write-Host "============================================================"
Write-Host " RideSync bootstrap (Windows)"
Write-Host "   repo: $root"
Write-Host "============================================================"

# --- 1. winget check --------------------------------------------------------
Write-Step "winget"
if (-not (Test-Cmd winget)) {
    Write-Host "    winget is missing. Install 'App Installer' from the Microsoft Store," -ForegroundColor Yellow
    Write-Host "    then re-run this script. Or use Docker instead." -ForegroundColor Yellow
    exit 1
}
Write-Host "    winget $(winget --version)"

# --- 2. Git (also provides bash) --------------------------------------------
Write-Step "Git"
if (-not (Test-Cmd git)) {
    Write-Host "    installing Git for Windows"
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "    already installed: $(git --version)"
}
# Find Git Bash (needed later for setup_db.sh)
$gitBash = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files (x86)\Git\bin\bash.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $gitBash) {
    Write-Host "    ERROR: bash.exe not found in Git installation. Reinstall Git for Windows." -ForegroundColor Red
    exit 1
}
Write-Host "    Git Bash: $gitBash"

# --- 3. PostgreSQL ----------------------------------------------------------
Write-Step "PostgreSQL"
if (Test-Cmd psql) {
    Write-Host "    already installed: $(psql --version)"
} else {
    Write-Host "    installing PostgreSQL 16"
    winget install --id PostgreSQL.PostgreSQL.16 -e --source winget `
        --accept-source-agreements --accept-package-agreements
    Write-Host "    NOTE: the installer sets the postgres superuser password." -ForegroundColor Yellow
    Write-Host "    Enter the password you chose during install when prompted later." -ForegroundColor Yellow
}

# --- 4. MongoDB -------------------------------------------------------------
Write-Step "MongoDB"
if (Test-Cmd mongosh) {
    Write-Host "    already installed: mongosh $(mongosh --version)"
} else {
    Write-Host "    installing MongoDB Community Server 7.0"
    winget install --id MongoDB.Server -e --source winget `
        --accept-source-agreements --accept-package-agreements
    Write-Host "    NOTE: MongoDB is installed as a Windows Service automatically." -ForegroundColor Yellow
}

# --- 5. Node 20 -------------------------------------------------------------
Write-Step "Node.js"
$needNode = $true
if (Test-Cmd node) {
    $major = [int](node -v).TrimStart('v').Split('.')[0]
    if ($major -ge 20) {
        Write-Host "    already installed: node $(node -v)"
        $needNode = $false
    }
}
if ($needNode) {
    Write-Host "    installing Node.js LTS"
    winget install --id OpenJS.NodeJS.LTS -e --source winget `
        --accept-source-agreements --accept-package-agreements
}

# --- 6. Python 3 ------------------------------------------------------------
Write-Step "Python"
if (-not (Test-Cmd python)) {
    Write-Host "    installing Python 3.11"
    winget install --id Python.Python.3.11 -e --source winget `
        --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "    already installed: $(python --version)"
}

# --- 7. Refresh PATH so newly-installed tools are found ---------------------
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

# --- 8. .env ----------------------------------------------------------------
Write-Step ".env"
if (Test-Path .env) {
    Write-Host "    .env already exists — leaving as-is"
} else {
    @'
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ridesync_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
MONGO_URI=mongodb://localhost:27017/
MONGO_DB=ridesync_db
API_PORT=4000
CORS_ORIGIN=http://localhost:5173
SIMULATE_TELEMETRY=true
SIMULATOR_TICK_MS=5000
SIMULATOR_VEHICLES_PER_TICK=150
'@ | Set-Content -Path .env -Encoding ASCII
    Write-Host "    wrote .env with default password 'postgres'."
    Write-Host "    If your PostgreSQL password is different, edit .env now." -ForegroundColor Yellow
}

# --- 9. Create database -----------------------------------------------------
Write-Step "Database"
$pgPass = (Get-Content .env | Where-Object { $_ -match '^POSTGRES_PASSWORD=' }) -replace '^POSTGRES_PASSWORD=',''
$env:PGPASSWORD = $pgPass
$exists = & psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='ridesync_db'" 2>$null
if ($exists -match '1') {
    Write-Host "    ridesync_db already exists"
} else {
    & createdb -U postgres -h localhost ridesync_db
    Write-Host "    created ridesync_db"
}

# --- 10. Python venv + deps -------------------------------------------------
Write-Step "Python dependencies"
$venv = Join-Path $root 'venv'
if (-not (Test-Path $venv)) {
    python -m venv $venv
    Write-Host "    created venv"
}
& "$venv\Scripts\python.exe" -m pip install -q --upgrade pip
& "$venv\Scripts\python.exe" -m pip install -q -r data_generation\requirements.txt
Write-Host "    psycopg2, pymongo, faker, tqdm, dotenv installed"

# --- 11. Schema + seed (via Git Bash) --------------------------------------
Write-Step "Loading schema, seeding databases (5-15 min)"
Write-Host "    running via Git Bash: $gitBash"
# Convert paths for bash
$rootBash = $root -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
$bashCmd = "cd '$rootBash' && source '$rootBash/venv/Scripts/activate' && bash scripts/setup_db.sh"
& $gitBash -lc $bashCmd

# --- 12. npm install --------------------------------------------------------
Write-Step "npm install (api)"
Push-Location "$root\api"
& npm install --silent
Pop-Location

Write-Step "npm install (web)"
Push-Location "$root\web"
& npm install --silent
Pop-Location

# --- 13. Done ---------------------------------------------------------------
Write-Host @"

============================================================
  RideSync is set up.
============================================================

Start the app (open two new PowerShell windows):

  Terminal 1 (API):
    cd $root\api
    npm start

  Terminal 2 (web):
    cd $root\web
    npm run dev

Then open:  http://localhost:5173

First thing to do in the app:
  pick a rider in "Acting as" at the top of the sidebar.

To stop later:
  Ctrl+C in each terminal.
  Stop-Service postgresql-x64-16, MongoDB     (databases, optional)
"@ -ForegroundColor Green
