#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Phase 21: start-demo.sh - Automated Local Environment Bootstrap
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
NC="\033[0m"

echo -e "${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}     STARTING LOCAL JITSI MEET + CUSTOM RECORDER BOT DEMO       ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}"

# Step 1: Environment & Dependency Audit
echo -e "\n${BOLD}[1/4] Running Environment Audit...${NC}"
./check-environment.sh

# Step 2: Start Jitsi Stack
echo -e "\n${BOLD}[2/4] Starting Jitsi Meet Cluster (Web, Prosody, Jicofo, JVB)...${NC}"
(
  cd "$SCRIPT_DIR/jitsi"
  docker compose up -d web prosody jicofo jvb
)

echo "Waiting for Jitsi Meet HTTPS endpoint (https://meet.localhost/)..."
MAX_RETRIES=30
COUNT=0
JITSI_READY=0
while [ $COUNT -lt $MAX_RETRIES ]; do
  if curl -k -s -o /dev/null -w "%{http_code}" https://meet.localhost/ | grep -q "200"; then
    JITSI_READY=1
    break
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

if [ $JITSI_READY -eq 1 ]; then
  echo -e "${GREEN}✔ Jitsi Meet is online and responding at https://meet.localhost/${NC}"
else
  echo -e "${YELLOW}Warning: Jitsi web endpoint is taking longer than usual to respond.${NC}"
fi

# Step 3: Start Recorder Service
echo -e "\n${BOLD}[3/4] Starting Isolated Recorder Service (Chromium + Xvfb + PulseAudio + FFmpeg)...${NC}"
(
  cd "$SCRIPT_DIR/recorder"
  docker compose up -d
)

echo "Waiting for Recorder API (http://localhost:3000/health)..."
COUNT=0
RECORDER_READY=0
while [ $COUNT -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:3000/health | grep -q '"status":"healthy"'; then
    RECORDER_READY=1
    break
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

if [ $RECORDER_READY -eq 1 ]; then
  echo -e "${GREEN}✔ Recorder API is healthy and listening on http://localhost:3000${NC}"
else
  echo -e "${YELLOW}Warning: Recorder API is taking longer than usual to respond.${NC}"
fi

# Step 4: Summary & Usage
API_KEY=$(grep '^RECORDER_API_KEY=' "$SCRIPT_DIR/recorder/.env" 2>/dev/null | cut -d= -f2- || echo "local-dev-secret-key-123")

echo -e "\n${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}                   DEMO ENVIRONMENT READY                       ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}Jitsi Web Interface:${NC}   https://meet.localhost"
echo -e "${BOLD}Sample Test Room:${NC}       https://meet.localhost/demo-class"
echo -e "${BOLD}Recorder API Base:${NC}     http://localhost:3000"
echo -e "${BOLD}Recorder Health Probe:${NC} http://localhost:3000/health"
echo -e "${BOLD}Recorder Metrics:${NC}      http://localhost:3000/metrics"
echo -e "${BOLD}API Authorization Key:${NC} $API_KEY"
echo -e "${BOLD}Recordings Storage:${NC}    $SCRIPT_DIR/recorder/recordings/<meeting_id>/"
echo -e "${CYAN}----------------------------------------------------------------${NC}"
echo -e "${BOLD}Quick Test Commands:${NC}"
echo -e "1. Run the end-to-end automated test:"
echo -e "   ${YELLOW}./test-recorder.sh${NC}"
echo -e ""
echo -e "2. Or manually trigger recording via curl:"
echo -e "   ${CYAN}curl -X POST http://localhost:3000/recordings/start \\"
echo -e "     -H \"Content-Type: application/json\" \\"
echo -e "     -H \"X-API-Key: ${API_KEY}\" \\"
echo -e "     -d '{\"meeting_id\": \"demo-class\", \"room_url\": \"https://meet.localhost/demo-class\"}'${NC}"
echo -e ""
echo -e "3. Stop recording:"
echo -e "   ${CYAN}curl -X POST http://localhost:3000/recordings/<RECORDING_ID>/stop \\"
echo -e "     -H \"X-API-Key: ${API_KEY}\"${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
