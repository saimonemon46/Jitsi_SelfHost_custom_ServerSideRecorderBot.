#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Executing Phase 14 Host Power-Loss Simulation..."
docker compose -f "$SCRIPT_DIR/recorder/docker-compose.yml" exec -T recorder node src/scripts/simulate-host-disconnect.js
