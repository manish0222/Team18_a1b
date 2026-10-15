# START COPY
#!/usr/bin/env bash
# =============================================================================
# RideSync — one-command Ubuntu bootstrap
#
# Usage:
#   git clone <repo>
#   cd <repo>
#   sudo bash scripts/bootstrap_ubuntu.sh
#
# Then follow the printed instructions to start the API and web app.
#
# What this does:
#   1. Installs missing tools (PostgreSQL, MongoDB, Node 20, Python venv)
#   2. Writes .env if absent
#   3. Creates the ridesync_db database
#   4. Installs Python dependencies in a venv
#   5. Runs scripts/setup_db.sh (schema, seeders, ledger back-fill, tests)
#   6. Runs npm install for api/ and web/
#
# Safe to re-run — every step is idempotent. Skips anything already installed.
# =============================================================================
set -euo pipefail

# --- 0. Sanity: root check ---------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "This script needs sudo (installs system packages)."
  echo "Run:  sudo bash scripts/bootstrap_ubuntu.sh"
  exit 1
fi

# Detect the real (non-root) user so files aren't created as root
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

echo "============================================================"
echo " RideSync bootstrap"
echo "   repo:      $ROOT"
echo "   real user: $REAL_USER"
echo "============================================================"

# --- 1. OS check -------------------------------------------------------------
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  echo
  echo "This script supports Ubuntu only (found: $ID)."
  echo "If you are on macOS / Windows / another Linux, use Docker instead:"
  echo "    docker compose up --build"
  exit 1
fi

if [ "${VERSION_ID:-}" = "20.04" ]; then
  echo "Ubuntu 20.04 detected. MongoDB 8.0 repo does not support 20.04 — will install 7.0."
  MONGO_VER="7.0"
else
  MONGO_VER="8.0"
fi

export DEBIAN_FRONTEND=noninteractive

have() { command -v "$1" >/dev/null 2>&1; }
step() { echo; echo "==> $*"; }

# --- 2. PostgreSQL -----------------------------------------------------------
step "PostgreSQL"
if have psql; then
  echo "    already installed: $(psql --version)"
else
  echo "    installing postgresql + contrib + libpq-dev"
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib libpq-dev
fi
systemctl enable --now postgresql
sleep 2
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true
echo "    postgres is running on :5432"

# --- 3. MongoDB --------------------------------------------------------------
step "MongoDB $MONGO_VER"
if have mongosh; then
  echo "    already installed: mongosh $(mongosh --version)"
else
  echo "    adding MongoDB $MONGO_VER apt repo"
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  curl -fsSL "https://www.mongodb.org/static/pgp/server-$MONGO_VER.asc" \
    | gpg -o "/usr/share/keyrings/mongodb-server-$MONGO_VER.gpg" --dearmor

  CODENAME="$(lsb_release -cs)"
  if ! curl -fsI "https://repo.mongodb.org/apt/ubuntu/dists/$CODENAME/mongodb-org/$MONGO_VER/Release" >/dev/null 2>&1; then
    echo "    no $MONGO_VER repo for $CODENAME; using jammy"
    CODENAME="jammy"
  fi

  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-$MONGO_VER.gpg ] \
https://repo.mongodb.org/apt/ubuntu $CODENAME/mongodb-org/$MONGO_VER multiverse" \
    > "/etc/apt/sources.list.d/mongodb-org-$MONGO_VER.list"

  apt-get update -qq
  apt-get install -y -qq mongodb-org
fi
systemctl enable --now mongod
sleep 2
echo "    mongod is running on :27017"

# --- 4. Node.js 20+ (checked in the REAL user's shell, not root's) -----------
step "Node.js"

NODE_V=""
if sudo -u "$REAL_USER" -H bash -lc "command -v node >/dev/null 2>&1"; then
  NODE_V="$(sudo -u "$REAL_USER" -H bash -lc 'node -v' 2>/dev/null || true)"
fi

NEED_NODE=1
if [ -n "$NODE_V" ]; then
  NODE_MAJOR="$(echo "$NODE_V" | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    echo "    already installed (user's shell): $NODE_V"
    NEED_NODE=0
  else
    echo "    found $NODE_V in user's shell — installing Node 20"
  fi
fi

if [ "$NEED_NODE" = "1" ]; then
  if dpkg -s libnode-dev >/dev/null 2>&1; then
    echo "    removing libnode-dev (conflicts with NodeSource)"
    apt-get remove --purge -y -qq libnode-dev || true
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

if sudo -u "$REAL_USER" -H bash -lc 'command -v node' >/dev/null 2>&1; then
  echo "    user shell: node $(sudo -u "$REAL_USER" -H bash -lc 'node -v'), npm $(sudo -u "$REAL_USER" -H bash -lc 'npm -v')"
else
  echo "    WARNING: node not found in user's shell"
fi

# --- 5. Python 3 + venv ------------------------------------------------------
step "Python"
if ! have python3; then apt-get install -y -qq python3; fi
if ! dpkg -s python3-venv >/dev/null 2>&1; then
  apt-get install -y -qq python3-venv python3-pip
fi
echo "    $(python3 --version)"

# --- 6. .env (never overwrite an existing one) -------------------------------
step ".env"
if [ -f .env ]; then
  echo "    .env already exists — leaving as-is"
else
  cat > .env <<'ENV'
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
ENV
  chown "$REAL_USER":"$REAL_USER" .env
  echo "    wrote .env"
fi

# --- 7. Create database ------------------------------------------------------
step "Database"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='ridesync_db'" | grep -q 1; then
  echo "    ridesync_db already exists"
else
  sudo -u postgres createdb ridesync_db
  echo "    created ridesync_db"
fi

# --- 8. Python venv + deps ---------------------------------------------------
step "Python dependencies"
VENV="$ROOT/venv"
if [ ! -d "$VENV" ]; then
  sudo -u "$REAL_USER" -H python3 -m venv "$VENV"
  echo "    created $VENV"
fi
sudo -u "$REAL_USER" -H "$VENV/bin/pip" install -q --upgrade pip
sudo -u "$REAL_USER" -H "$VENV/bin/pip" install -q -r data_generation/requirements.txt
echo "    psycopg2, pymongo, faker, tqdm, dotenv installed"

# --- 9. Schema + seed (uses the venv's python) -------------------------------
step "Loading schema, seeding databases (this takes 5-15 min)"
sudo -u "$REAL_USER" -H bash -c "
  cd '$ROOT'
  source '$VENV/bin/activate'
  bash scripts/setup_db.sh
"

# --- 10. npm install ---------------------------------------------------------
step "npm install (api)"
sudo -u "$REAL_USER" -H bash -c "cd '$ROOT/api' && npm install --silent"

step "npm install (web)"
sudo -u "$REAL_USER" -H bash -c "cd '$ROOT/web' && npm install --silent"

# --- 11. Done ----------------------------------------------------------------
cat <<'DONE'

============================================================
  RideSync is set up.
============================================================

Start the app:

  Terminal 1 (API):
    cd api && npm start

  Terminal 2 (web):
    cd web && npm run dev

Then open:  http://localhost:5173

First thing to do in the app:
  pick a rider in "Acting as" at the top of the sidebar.

To stop later:
  Ctrl+C in each terminal.
  sudo systemctl stop postgresql mongod      (databases, optional)

To re-seed from scratch:
  RESEED=1 bash scripts/setup_db.sh
DONE
# END COPY
