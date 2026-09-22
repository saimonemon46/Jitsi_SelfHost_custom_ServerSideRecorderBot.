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

# Step 2: Start Jitsi Stack + Jibri
echo -e "\n${BOLD}[2/3] Starting Jitsi Meet Cluster + Jibri (Web, Prosody, Jicofo, JVB, Jibri)...${NC}"
mkdir -p "$SCRIPT_DIR/jitsi-cfg/web" "$SCRIPT_DIR/jitsi-cfg/jibri" "$SCRIPT_DIR/jitsi-cfg/storage/jibri/recordings"
cp -r "$SCRIPT_DIR/jitsi-config-templates/"* "$SCRIPT_DIR/jitsi-cfg/"
(
  cd "$SCRIPT_DIR/jitsi"
  docker compose up -d
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

# Step 3: Verify Jibri Status
echo -e "\n${BOLD}[3/3] Checking Jibri Health...${NC}"
COUNT=0
JIBRI_READY=0
while [ $COUNT -lt $MAX_RETRIES ]; do
  if docker exec jitsi-jibri-1 curl -s http://127.0.0.1:2222/jibri/api/v1.0/health 2>/dev/null | grep -q '"healthStatus":"HEALTHY"'; then
    JIBRI_READY=1
    break
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

if [ $JIBRI_READY -eq 1 ]; then
  echo -e "${GREEN}✔ Jibri is healthy and ready to record (Status: IDLE).${NC}"
else
  echo -e "${YELLOW}Notice: Jibri is still initializing. Check logs with 'docker compose logs -f jibri'.${NC}"
fi

# Summary & Usage
echo -e "\n${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}                   JITSI + JIBRI ENVIRONMENT READY              ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}Jitsi Web Interface:${NC}   https://meet.localhost"
echo -e "${BOLD}Sample Test Room:${NC}       https://meet.localhost/test-recording"
echo -e "${BOLD}Recordings Storage:${NC}    $SCRIPT_DIR/jitsi-cfg/storage/jibri/"
echo -e "${CYAN}----------------------------------------------------------------${NC}"
echo -e "${BOLD}How to Test Recording:${NC}"
echo -e "1. Open ${YELLOW}https://meet.localhost/test-recording${NC} in your browser."
echo -e "2. In the bottom toolbar, click ${BOLD}⋮ (More actions)${NC}."
echo -e "3. Click ${CYAN}Start recording${NC}."
echo -e "4. When finished, click ${CYAN}Stop recording${NC}."
echo -e "5. The saved MP4 will be in ${YELLOW}$SCRIPT_DIR/jitsi-cfg/storage/jibri/${NC}"
echo -e ""
echo -e "${BOLD}Useful Commands:${NC}"
echo -e "- View Jibri logs:   ${CYAN}docker compose -C jitsi logs -f jibri${NC}"
echo -e "- Check container:   ${CYAN}docker compose -C jitsi ps${NC}"
echo -e "- Stop all services: ${CYAN}docker compose -C jitsi down${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"

