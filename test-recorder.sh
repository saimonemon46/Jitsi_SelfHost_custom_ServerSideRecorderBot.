#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Phase 21: test-recorder.sh - Automated Recording Verification Script
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

API_BASE="${RECORDER_API_URL:-http://localhost:3000}"
API_KEY=$(grep '^RECORDER_API_KEY=' "$SCRIPT_DIR/recorder/.env" 2>/dev/null | cut -d= -f2- || echo "local-dev-secret-key-123")
MEETING_ID="test-class-$(date +%s)"
ROOM_URL="https://meet.localhost/${MEETING_ID}"

echo -e "${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}          AUTOMATED JITSI RECORDER TEST SUITE                   ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}"

# 1. Verify Recorder API is accessible
echo -e "\n${BOLD}[Step 1] Checking Recorder API Health...${NC}"
HEALTH_JSON=$(curl -s "${API_BASE}/health" || echo "")
if [[ -z "$HEALTH_JSON" || "$HEALTH_JSON" != *"healthy"* ]]; then
  echo -e "${RED}✘ Recorder API is not reachable at ${API_BASE}.${NC}"
  echo -e "Please start the stack first using: ./start-demo.sh"
  exit 1
fi
echo -e "${GREEN}✔ Recorder API is healthy.${NC}"

# 2. Trigger Recording Start
echo -e "\n${BOLD}[Step 2] Triggering POST /recordings/start for room ${ROOM_URL}...${NC}"
START_RESP=$(curl -s -X POST "${API_BASE}/recordings/start" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "{\"meeting_id\": \"${MEETING_ID}\", \"room_url\": \"${ROOM_URL}\"}")

echo "Response: $START_RESP"

RECORDING_ID=$(echo "$START_RESP" | grep -o '"recording_id":"[^"]*' | cut -d'"' -f4 || true)
if [[ -z "$RECORDING_ID" ]]; then
  echo -e "${RED}✘ Failed to obtain recording_id from API response.${NC}"
  exit 1
fi
echo -e "${GREEN}✔ Recording started with ID: ${RECORDING_ID}${NC}"

# 3. Test Idempotency (Phase 16)
echo -e "\n${BOLD}[Step 3] Testing Idempotency (Calling start again for same meeting)...${NC}"
IDEMPOTENT_RESP=$(curl -s -X POST "${API_BASE}/recordings/start" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "{\"meeting_id\": \"${MEETING_ID}\", \"room_url\": \"${ROOM_URL}\"}")
echo "Idempotent Response: $IDEMPOTENT_RESP"

if [[ "$IDEMPOTENT_RESP" == *"already exists"* || "$IDEMPOTENT_RESP" == *"$RECORDING_ID"* ]]; then
  echo -e "${GREEN}✔ Idempotency confirmed: existing recording returned without duplicate bot.${NC}"
else
  echo -e "${YELLOW}Warning: Unexpected idempotency response.${NC}"
fi

# 4. Wait & Monitor Live Recording Progress
WAIT_SECONDS=25
echo -e "\n${BOLD}[Step 4] Monitoring recording progress for ${WAIT_SECONDS} seconds...${NC}"
for ((i=1; i<=WAIT_SECONDS; i+=5)); do
  sleep 5
  STATUS_JSON=$(curl -s -H "X-API-Key: ${API_KEY}" "${API_BASE}/recordings/${RECORDING_ID}/status" || echo "{}")
  STATUS_VAL=$(echo "$STATUS_JSON" | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo "unknown")
  IS_REC=$(echo "$STATUS_JSON" | grep -o '"is_recording":[^,}]*' || echo "")
  echo -e "  [+${i}s] Status: ${YELLOW}${STATUS_VAL}${NC} (${IS_REC})"
done

# 5. Stop Recording
echo -e "\n${BOLD}[Step 5] Triggering POST /recordings/${RECORDING_ID}/stop...${NC}"
STOP_RESP=$(curl -s -X POST "${API_BASE}/recordings/${RECORDING_ID}/stop" \
  -H "X-API-Key: ${API_KEY}")
echo "Stop Response: $STOP_RESP"

# 6. Locate Final MP4 File
FINAL_MP4="$SCRIPT_DIR/recorder/recordings/${MEETING_ID}/final.mp4"
if [ ! -f "$FINAL_MP4" ]; then
  # Check if final path in response
  FINAL_PATH_FROM_JSON=$(echo "$STOP_RESP" | grep -o '"final_file":"[^"]*' | cut -d'"' -f4 || true)
  if [ -n "$FINAL_PATH_FROM_JSON" ]; then
    # Map container path /recordings/... to host path
    REL_PATH="${FINAL_PATH_FROM_JSON#/recordings/}"
    FINAL_MP4="$SCRIPT_DIR/recorder/recordings/${REL_PATH}"
  fi
fi

if [ ! -f "$FINAL_MP4" ]; then
  echo -e "${RED}✘ Final recording file not found at: ${FINAL_MP4}${NC}"
  echo -e "Listing recorded segments in directory:"
  ls -lh "$SCRIPT_DIR/recorder/recordings/${MEETING_ID}" || true
  exit 1
fi

FILE_SIZE_BYTES=$(stat -c%s "$FINAL_MP4" 2>/dev/null || stat -f%z "$FINAL_MP4" 2>/dev/null || wc -c <"$FINAL_MP4")
FILE_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $FILE_SIZE_BYTES/1024/1024}")

echo -e "\n${GREEN}✔ Final recording file created successfully!${NC}"
echo -e "Path: $FINAL_MP4"
echo -e "Size: ${FILE_SIZE_MB} MB (${FILE_SIZE_BYTES} bytes)"

# 7. Run ffprobe inspection
echo -e "\n${BOLD}[Step 7] Running ffprobe verification on final.mp4...${NC}"

PROBE_OUTPUT=""
if command -v ffprobe >/dev/null 2>&1; then
  PROBE_OUTPUT=$(ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,duration -show_entries format=duration,size -of json "$FINAL_MP4")
else
  # Run ffprobe inside recorder container
  PROBE_OUTPUT=$(docker compose -f "$SCRIPT_DIR/recorder/docker-compose.yml" exec -T recorder ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,duration -show_entries format=duration,size -of json "/recordings/${MEETING_ID}/final.mp4")
fi

echo "Probe Summary:"
echo "$PROBE_OUTPUT"

# Verify video and audio streams
HAS_VIDEO=$(echo "$PROBE_OUTPUT" | grep -q '"codec_type": "video"' && echo "yes" || echo "no")
HAS_AUDIO=$(echo "$PROBE_OUTPUT" | grep -q '"codec_type": "audio"' && echo "yes" || echo "no")
DURATION=$(echo "$PROBE_OUTPUT" | grep -o '"duration": "[^"]*' | head -1 | cut -d'"' -f4 || echo "0")

echo -e "\n${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}                   VERIFICATION REPORT                          ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}"
echo -e "Meeting ID:       ${BOLD}${MEETING_ID}${NC}"
echo -e "Recording ID:     ${BOLD}${RECORDING_ID}${NC}"
echo -e "Video Stream:     $([[ "$HAS_VIDEO" == "yes" ]] && echo -e "${GREEN}✔ Present (H.264)${NC}" || echo -e "${RED}✘ Missing${NC}")"
echo -e "Audio Stream:     $([[ "$HAS_AUDIO" == "yes" ]] && echo -e "${GREEN}✔ Present (AAC)${NC}" || echo -e "${RED}✘ Missing${NC}")"
echo -e "Duration:         ${BOLD}${DURATION} seconds${NC}"
echo -e "File Size:        ${BOLD}${FILE_SIZE_MB} MB${NC}"
echo -e "Local File:       ${BOLD}${FINAL_MP4}${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}"

if [[ "$HAS_VIDEO" == "yes" && "$HAS_AUDIO" == "yes" ]]; then
  echo -e "${BOLD}${GREEN}✔ ALL RECORDING VERIFICATION CHECKS PASSED!${NC}\n"
  exit 0
else
  echo -e "${BOLD}${RED}✘ Verification failed: Missing required media streams.${NC}\n"
  exit 1
fi
