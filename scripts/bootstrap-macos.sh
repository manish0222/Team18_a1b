#!/usr/bin/env bash
# =============================================================================
# RideSync bootstrap — macOS
#
# Usage:
#   git clone -b mandemo <repo>
#   cd <repo>
#   bash scripts/bootstrap-macos.sh
#
# No sudo needed. Uses Homebrew.
# =============================================================================
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS. Found: $(uname -s)"
  echo "On Ubuntu, run: sudo bash scripts/bootstrap.sh"
  exit 1
fi

REAL_USER="$(whoami)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "============================================================"
echo " RideSync bootstrap (macOS)"
echo "   repo:      $ROOT"
echo "   real user: $REAL_USER"
echo "============================================================"

have() { command -v "$1" >/dev/null 2>&1; }
step() { echo; echo "==> $*"; }

# --- 1. Homebrew -------------------------------------------------------------
step "Homebrew"
if ! have brew; then
  echo "    installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this session (Apple Silicon vs Intel)
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
else
  echo "    already installed: $(brew --version | head -1)"
fi
# Make sure brew is on PATH even if this shell didn't load it
if ! have brew; then
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$p" ]; then eval "$($p shellenv)"; break; fi
  done
fi

# --- 2. PostgreSQL -----------------------------------------------------------
step "PostgreSQL"
if have psql; then
  echo "    already installed: $(psql --version)"
else
  echo "    installing postgresql@16"
  brew install postgresql@16
fi
brew services start postgresql@16
sleep 3

# brew's postgres uses the current macOS user as superuser, no password
# Create the ridesync_db database if missing
if psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw ridesync_db; then
  echo "    ridesync_db already exists"
else
  createdb ridesync_db 2>/dev/null || true
  echo "    created ridesync_db"
fi
echo "    postgres is running on :5432"

# --- 3. MongoDB --------------------------------------------------------------
step "MongoDB"
if have mongosh; then
  echo "    already installed: mongosh $(mongosh --version)"
else
  echo "    installing mongodb-community@7.0"
  brew tap mongodb/brew
  brew install mongodb-community@7.0
fi
brew services start mongodb-community@7.0
sleep 3
echo "    mongod is running on :27017"

# --- 4. Node 20 --------------------------------------------------------------
step "Node.js"
NEED_NODE=1
if have node; then
  NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" -ge 20 ]; then
    echo "    already installed: node $(node -v)"
    NEED_NODE=0
  fi
fi
if [ "$NEED_NODE" = "1" ]; then
  brew install node@20
  # node@20 is keg-only on brew
  if [ -x /opt/homebrew/opt/node@20/bin/node ]; then
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
  elif [ -x /usr/local/opt/node@20/bin/node ]; then
    export PATH="/usr/local/opt/node@20/bin:$PATH"
  fi
fi
echo "    node $(node -v), npm $(npm -v)"

# --- 5. Python 3 -------------------------------------------------------------
step "Python"
if ! have python3; then
  brew install python@3.11
fi
echo "    $(python3 --version)"

# --- 6. .env -----------------------------------------------------------------
step ".env"
if [ -f .env ]; then
  echo "    .env already exists — leaving as-is"
else
  # macOS brew postgres uses the current user, empty password
  cat > .env <<ENV
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ridesync_db
POSTGRES_USER=$REAL_USER
POSTGRES_PASSWORD=
MONGO_URI=mongodb://localhost:27017/
MONGO_DB=ridesync_db
API_PORT=4000
CORS_ORIGIN=http://localhost:5173
SIMULATE_TELEMETRY=true
SIMULATOR_TICK_MS=5000
SIMULATOR_VEHICLES_PER_TICK=150
ENV
  echo "    wrote .env (using macOS user '$REAL_USER', no password)"
fi

# --- 7. Python venv + deps ---------------------------------------------------
step "Python dependencies"
VENV="$ROOT/venv"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r data_generation/requirements.txt
echo "    psycopg2, pymongo, faker, tqdm, dotenv installed"

# --- 8. Schema + seed --------------------------------------------------------
step "Loading schema, seeding databases (this takes 5-15 min)"
(
  source "$VENV/bin/activate"
  bash scripts/setup_db.sh
)

# --- 9. npm install ----------------------------------------------------------
step "npm install (api)"
(cd "$ROOT/api" && npm install --silent)

step "npm install (web)"
(cd "$ROOT/web" && npm install --silent)

# --- 10. Done ----------------------------------------------------------------
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
  brew services stop postgresql@16 mongodb-community@7.0
DONE
