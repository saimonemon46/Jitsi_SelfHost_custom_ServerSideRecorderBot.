#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Phase 1: Host Machine & Recorder Environment Audit Script
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m" # No Color

echo -e "${BOLD}${CYAN}======================================================${NC}"
echo -e "${BOLD}${CYAN}  JITSI MEET + RECORDER ENVIRONMENT AUDIT             ${NC}"
echo -e "${BOLD}${CYAN}======================================================${NC}"

HAS_FAILURES=0

# 1. OS and Distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_NAME="${PRETTY_NAME:-$NAME}"
else
    OS_NAME=$(uname -s)
fi
KERNEL_VER=$(uname -r)
ARCH=$(uname -m)

echo -e "${BOLD}Operating System:${NC}  $OS_NAME"
echo -e "${BOLD}Kernel:${NC}            $KERNEL_VER"
echo -e "${BOLD}Architecture:${NC}      $ARCH"

# 2. CPU Cores
CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo "1")
CPU_MODEL=$(lscpu 2>/dev/null | grep -m1 "Model name:" | sed 's/Model name:[[:space:]]*//' || echo "Unknown")
echo -e "${BOLD}CPU Model:${NC}         $CPU_MODEL"
echo -e "${BOLD}CPU Cores:${NC}         $CPU_CORES"
if [ "$CPU_CORES" -lt 2 ]; then
    echo -e "  ${YELLOW}[WARNING] Less than 2 CPU cores. Recommended: >= 4 cores for Jitsi + Recorder.${NC}"
fi

# 3. Memory (RAM)
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$(( TOTAL_RAM_KB / 1024 ))
TOTAL_RAM_GB=$(awk "BEGIN {printf \"%.1f\", $TOTAL_RAM_MB/1024}")
AVAIL_RAM_KB=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
AVAIL_RAM_MB=$(( AVAIL_RAM_KB / 1024 ))
AVAIL_RAM_GB=$(awk "BEGIN {printf \"%.1f\", $AVAIL_RAM_MB/1024}")

echo -e "${BOLD}Total RAM:${NC}         ${TOTAL_RAM_GB} GB (${TOTAL_RAM_MB} MB)"
echo -e "${BOLD}Available RAM:${NC}     ${AVAIL_RAM_GB} GB (${AVAIL_RAM_MB} MB)"

if [ "$TOTAL_RAM_MB" -lt 4096 ]; then
    echo -e "  ${YELLOW}[WARNING] Total RAM is less than 4GB. Jitsi + Chromium may experience memory pressure.${NC}"
fi

# 4. Disk Space
DISK_DIR="${1:-$(pwd)}"
FREE_DISK_KB=$(df -k "$DISK_DIR" | tail -1 | awk '{print $4}')
FREE_DISK_GB=$(awk "BEGIN {printf \"%.1f\", $FREE_DISK_KB/1024/1024}")
echo -e "${BOLD}Disk Space (${DISK_DIR}):${NC} ${FREE_DISK_GB} GB free"
if [ "$FREE_DISK_KB" -lt 5242880 ]; then # 5GB
    echo -e "  ${YELLOW}[WARNING] Less than 5GB free disk space. Continuous recording produces ~1.5GB/hr at 4Mbps.${NC}"
fi

echo -e "\n${BOLD}${CYAN}--- Runtime & Container Dependencies ---${NC}"

# 5. Docker
if command -v docker >/dev/null 2>&1; then
    DOCKER_VER=$(docker --version)
    echo -e "  ${GREEN}✔${NC} Docker:             $DOCKER_VER"
    # Check if docker daemon is reachable
    if docker info >/dev/null 2>&1; then
        echo -e "    ${GREEN}✔${NC} Docker Daemon is running and accessible."
    else
        echo -e "    ${RED}✘ Docker Daemon is not running or current user lacks permission.${NC}"
        HAS_FAILURES=1
    fi
else
    echo -e "  ${RED}✘ Docker is NOT installed.${NC}"
    HAS_FAILURES=1
fi

# 6. Docker Compose
DOCKER_COMPOSE_OK=0
if docker compose version >/dev/null 2>&1; then
    COMPOSE_VER=$(docker compose version)
    echo -e "  ${GREEN}✔${NC} Docker Compose:     $COMPOSE_VER (plugin)"
    DOCKER_COMPOSE_OK=1
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_VER=$(docker-compose --version)
    echo -e "  ${GREEN}✔${NC} Docker Compose:     $COMPOSE_VER (standalone)"
    DOCKER_COMPOSE_OK=1
else
    echo -e "  ${RED}✘ Docker Compose is NOT installed.${NC}"
    HAS_FAILURES=1
fi

# 7. Host Audio Subsystem (PipeWire / PulseAudio)
echo -e "\n${BOLD}${CYAN}--- Audio Subsystem Audit ---${NC}"
AUDIO_FOUND=0
if command -v pactl >/dev/null 2>&1 && pactl info >/dev/null 2>&1; then
    SERVER_NAME=$(pactl info | grep "Server Name:" | cut -d: -f2- | xargs)
    echo -e "  ${GREEN}✔${NC} PulseAudio/PipeWire pactl interface active: $SERVER_NAME"
    AUDIO_FOUND=1
elif command -v pipewire >/dev/null 2>&1; then
    echo -e "  ${GREEN}✔${NC} PipeWire binary found on host."
    AUDIO_FOUND=1
elif command -v pulseaudio >/dev/null 2>&1; then
    echo -e "  ${GREEN}✔${NC} PulseAudio binary found on host."
    AUDIO_FOUND=1
else
    echo -e "  ${YELLOW}ℹ Host audio server not detected directly via pactl. (Isolated container audio will manage its own Pulse server).${NC}"
fi

# 8. Local Host Media Tools (Optional for container mode, required for bare-metal mode)
echo -e "\n${BOLD}${CYAN}--- Host Native Recording Tools (Optional if running Recorder in Docker) ---${NC}"

if command -v ffmpeg >/dev/null 2>&1; then
    FFMPEG_VER=$(ffmpeg -version | head -n1)
    echo -e "  ${GREEN}✔${NC} FFmpeg:             $FFMPEG_VER"
else
    echo -e "  ${YELLOW}ℹ Host FFmpeg:        Not installed (provided inside Recorder Docker container)${NC}"
fi

if command -v Xvfb >/dev/null 2>&1; then
    echo -e "  ${GREEN}✔${NC} Xvfb:               Installed on host"
else
    echo -e "  ${YELLOW}ℹ Host Xvfb:          Not installed (provided inside Recorder Docker container)${NC}"
fi

CHROME_BIN=""
for b in chromium-browser chromium google-chrome google-chrome-stable; do
    if command -v "$b" >/dev/null 2>&1; then
        CHROME_BIN=$(command -v "$b")
        break
    fi
done
if [ -n "$CHROME_BIN" ]; then
    CHROME_VER=$("$CHROME_BIN" --version 2>/dev/null || echo "detected")
    echo -e "  ${GREEN}✔${NC} Host Chromium:      $CHROME_VER ($CHROME_BIN)"
else
    echo -e "  ${YELLOW}ℹ Host Chromium:      Not installed (Playwright container manages its own Chromium)${NC}"
fi

if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo -e "  ${GREEN}✔${NC} Node.js:            $NODE_VER"
else
    echo -e "  ${YELLOW}ℹ Host Node.js:       Not installed (provided in Docker container)${NC}"
fi

echo -e "\n${BOLD}${CYAN}======================================================${NC}"
if [ "$HAS_FAILURES" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}✔ SYSTEM AUDIT PASSED:${NC} Required core dependencies (Docker, Docker Compose, resources) are met."
    echo -e "The Recorder and Jitsi can be deployed via container isolation."
    exit 0
else
    echo -e "${RED}${BOLD}✘ SYSTEM AUDIT FAILED:${NC} Missing essential requirements above. Please resolve errors before continuing."
    exit 1
fi
