#!/usr/bin/env bash
# =============================================================================
# RideSync bootstrap — OS dispatcher
#
# Runs the right per-OS setup script:
#   Linux   → bootstrap-ubuntu.sh
#   macOS   → bootstrap-macos.sh
#
# Usage:
#   Linux:  sudo bash scripts/bootstrap.sh
#   macOS:  bash scripts/bootstrap.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

case "$(uname -s)" in
  Linux)
    echo "==> Linux detected — running Ubuntu bootstrap"
    exec bash "$ROOT/bootstrap-ubuntu.sh" "$@"
    ;;
  Darwin)
    echo "==> macOS detected — running macOS bootstrap"
    exec bash "$ROOT/bootstrap-macos.sh" "$@"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)"
    echo "On Windows, use Docker instead:"
    echo "    git clone <repo> && cd <repo> && docker compose up --build"
    exit 1
    ;;
esac
