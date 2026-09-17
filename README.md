# Self-Hosted Jitsi Meet with Jibri Recording Infrastructure

A fully containerized, production-ready, self-hosted **Jitsi Meet** environment on Linux integrated with **Jibri (Jitsi Broadcasting Infrastructure)** for server-side meeting recording and streaming.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Repository Structure](#3-repository-structure)
4. [Quick Start (How to Run)](#4-quick-start-how-to-run)
5. [How Jibri Works Under the Hood](#5-how-jibri-works-under-the-hood)
6. [Configuration Reference (`jitsi/.env`)](#6-configuration-reference-jitsienv)
7. [How to Build Jibri](#7-how-to-build-jibri)
8. [How to Record a Meeting](#8-how-to-record-a-meeting)
9. [Troubleshooting & Common Pitfalls](#9-troubleshooting--common-pitfalls)
10. [Alternative Custom Recorder Bot (`recorder/`)](#10-alternative-custom-recorder-bot-recorder)

---

## 1. Architecture Overview

The system runs on Docker Compose, integrating the official Jitsi Meet cluster services with Jibri:

```
                               LOCAL LINUX HOST
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                                                                             │
 │                            JITSI MEET CLUSTER                               │
 │                                                                             │
 │   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────┐   │
 │   │   Prosody    │◄───►│    Jicofo    │◄───►│     JVB      │◄───►│ Web  │   │
 │   │ (XMPP Core)  │     │ (Focus Mgmt) │     │ (Videobridge)│     │(Nginx│   │
 │   └──────▲───────┘     └──────▲───────┘     └──────────────┘     └──────┘   │
 │          │                    │                                             │
 │          │ XMPP MUC           │ Brewery Discovery                           │
 │          │ (jibribrewery)     │ & Recording Dispatch                        │
 │          ▼                    ▼                                             │
 │   ┌─────────────────────────────────────────────────────────────────────┐   │
 │   │                           JIBRI SERVICE                             │   │
 │   │                                                                     │   │
 │   │   ┌───────────────────┐        ┌───────────────────────────────┐    │   │
 │   │   │  Jibri Core App   │        │     Virtual X11 & Audio       │    │   │
 │   │   │  (Kotlin / Java)  │        │  Xorg (dummy) + PulseAudio    │    │   │
 │   │   └─────────┬─────────┘        └───────────────┬───────────────┘    │   │
 │   │             │                                  │                    │   │
 │   │             ▼                                  ▼                    │   │
 │   │   ┌───────────────────┐        ┌───────────────────────────────┐    │   │
 │   │   │   Google Chrome   │───────►│        FFmpeg Pipeline        │    │   │
 │   │   │   (ChromeDriver)  │ Render │  x11grab (:0.0) + pulse input │    │   │
 │   │   └───────────────────┘        └───────────────┬───────────────┘    │   │
 │   │                                                │                    │   │
 │   │                                                ▼                    │   │
 │   │                                         [ Output MP4 ]              │   │
 │   └────────────────────────────────────────────────┬────────────────────┘   │
 │                                                    ▼                        │
 │                           Storage: jitsi-cfg/storage/jibri/recordings/      │
 └─────────────────────────────────────────────────────────────────────────────┘
```

### Core Components:
* **Web (Nginx)**: Serves Jitsi Meet web assets, handles HTTPS, and proxies BOSH / WebSocket traffic.
* **Prosody (XMPP)**: Manages authentication, user sessions, chat, and the internal `jibribrewery` coordination MUC.
* **Jicofo (Focus)**: Manages conference allocation, bridge selection, and dynamically assigns recording requests to idle Jibri instances.
* **JVB (Jitsi Videobridge)**: WebRTC SFU that routes audio/video RTP packets between participants and Jibri.
* **Jibri (Recorder)**: Official headless broadcasting daemon. Joins conferences as a hidden participant, renders via Chrome on a virtual X11 display, and records video + audio to MP4 with FFmpeg.

---

## 2. Prerequisites

* **Operating System**: Linux (Ubuntu, Debian, Linux Mint, Fedora, etc.)
* **Docker**: `>= 24.0`
* **Docker Compose**: `>= 2.20` (Compose V2 plugin)
* **System Resources**: Minimum 4 CPU cores and 8 GB RAM recommended for smooth 1080p/720p recording.

---

## 3. Repository Structure

```
.
├── jitsi/                      # Official docker-jitsi-meet configuration
│   ├── docker-compose.yml      # Base cluster: web, prosody, jicofo, jvb
│   ├── jibri.yml               # Jibri recorder service definition
│   ├── jibri/                  # Jibri Dockerfile and image resources
│   ├── Makefile                # Multi-service build and packaging automation
│   ├── .env                    # Runtime environment variables (gitignored)
│   └── env.example             # Documented template with Jibri settings
├── jitsi-cfg/                  # Persistent configuration & storage mounts
│   ├── web/                    # Nginx and web client configs
│   ├── prosody/                # Prosody accounts and certificates
│   ├── jicofo/                 # Focus daemon configuration
│   ├── jvb/                    # Videobridge settings
│   └── storage/
│       └── jibri/              # Persistent recordings and Jibri log files
│           ├── recordings/     # Completed MP4 files and metadata.json
│           └── logs/           # Jibri, Chrome, PulseAudio, and FFmpeg logs
├── recorder/                   # Legacy/custom standalone Playwright recorder bot
├── check-environment.sh        # Audit script checking CPU, RAM, Docker, & tools
├── start-demo.sh               # Automated one-step bootstrap and health check
└── README.md                   # This documentation
```

---

## 4. Quick Start (How to Run)

Because `COMPOSE_FILE=docker-compose.yml:jibri.yml` is configured in `jitsi/.env`, all standard Docker Compose commands automatically manage Jibri.

### Method 1: Automated Demo Script
```bash
./start-demo.sh
```
This script audits your environment, starts all services, confirms health probes, and outputs test URLs.

### Method 2: Standard Docker Compose Commands
From the `jitsi/` directory:

```bash
cd jitsi

# 1. Start all services in the background
docker compose up -d

# 2. Check running status
docker compose ps

# 3. Follow live Jibri activity & recording logs
docker compose logs -f jibri

# 4. Restart Jibri (e.g. after editing .env)
docker compose restart jibri

# 5. Stop all services
docker compose down
```

---

## 5. How Jibri Works Under the Hood

When a moderator clicks **"Start recording"** in Jitsi Meet:

1. **Signaling**: Jicofo sends an XMPP IQ request to the `jibribrewery` MUC room.
2. **Acceptance**: An idle Jibri worker acknowledges the request and transitions from `IDLE` to `BUSY`.
3. **Display & Audio Setup**:
   * Jibri runs an internal Xorg dummy display (`DISPLAY=:0`).
   * A PulseAudio null-sink (`jibri-loop`) is set as the default output device.
4. **Browser Launch**:
   * Jibri starts Google Chrome via ChromeDriver with flags:
     * `--autoplay-policy=no-user-gesture-required`: **Essential**. Prevents Chrome from muting remote audio elements in headless/unattended mode.
     * `--host-resolver-rules=MAP meet.localhost web:8443`: Resolves the local domain directly to the internal web container.
     * `--ignore-certificate-errors`: Bypasses self-signed SSL certificate prompts for local development.
5. **Recording Execution**:
   * FFmpeg grabs video frames from the X11 virtual display (`-f x11grab -i :0.0+0,0`).
   * FFmpeg captures audio directly from PulseAudio (`-f pulse -i default` on `jibri-loop.monitor`).
   * Streams are encoded to H.264 video + AAC audio and multiplexed into `.mp4`.
6. **Finalization**:
   * When stopped, FFmpeg writes the moov atom, flushes the file, and moves it to `/storage/recordings/<UUID>/<room_name>_<timestamp>.mp4`.
   * Jibri transitions back to `IDLE` and re-announces availability to Jicofo.

---

## 6. Configuration Reference (`jitsi/.env`)

The key variables enabling and tuning Jibri in `jitsi/.env`:

```ini
# ==============================================================================
# JIBRI & RECORDING CONFIGURATION
# ==============================================================================

# Enable recording features across Web, Prosody, and Jicofo
ENABLE_RECORDING=1
ENABLE_SERVICE_RECORDING=1

# Coordination MUC room on Prosody
JIBRI_BREWERY_MUC=jibribrewery

# Internal XMPP service accounts (auto-created by Prosody)
JIBRI_RECORDER_USER=recorder
JIBRI_RECORDER_PASSWORD=c6d2293628ce8271eae7d8d6740bdec1
JIBRI_XMPP_USER=jibri
JIBRI_XMPP_PASSWORD=2fc4f42cf680ab7ca7da3a04d700ef3a

# Internal recording output directory in container
JIBRI_RECORDING_DIR=/storage/recordings

# Local SSL Certificate Bypasses
IGNORE_CERTIFICATE_ERRORS=true
XMPP_TRUST_ALL_CERTS=true

# Chrome launch flags (Autoplay bypass + Local network resolution)
CHROMIUM_FLAGS=--autoplay-policy=no-user-gesture-required,--use-fake-ui-for-media-stream,--start-maximized,--kiosk,--enabled,--host-resolver-rules=MAP meet.localhost web:8443,--ignore-certificate-errors

# Automatically include jibri.yml in Docker Compose
COMPOSE_FILE=docker-compose.yml:jibri.yml
```

---

## 7. How to Build Jibri

If you want to customize Jibri's internal scripts, Chrome version, or FFmpeg encoding presets:

### Method 1: Using the Makefile (Recommended)
```bash
cd jitsi

# Build Jibri only
make build_jibri

# (Optional) Build all images
make all
```

### Method 2: Using `docker build`
```bash
cd jitsi

docker build \
  -t ghcr.io/jitsi/jibri:stable-11248 \
  -f jibri/Dockerfile \
  jibri/
```

### Method 3: Custom Tagged Local Image
```bash
cd jitsi

# Build local custom image
docker build -t jitsi/jibri:latest -f jibri/Dockerfile jibri/

# Update jitsi/.env:
# JITSI_IMAGE_REPO=jitsi
# JITSI_IMAGE_VERSION=latest

# Restart Jibri with your new image
docker compose up -d jibri
```

---

## 8. How to Record a Meeting

### Step 1: Open a Meeting
Navigate in your browser to:
**`https://meet.localhost/test-recording`**

> [!IMPORTANT]
> **Moderator Requirement**: In Jitsi Meet, only **Moderators** (owners) have permission to start or stop recordings. The first person to join a new room automatically receives moderator status (`ENABLE_AUTO_OWNER=true`). If you join an existing room after another participant, you may be a guest and will not see the recording option.

### Step 2: Start Recording
1. In the bottom control toolbar, click the **`⋮` (More actions)** button.
2. Click **"Start recording"**.
3. Confirm the recording prompt dialog.
4. A red **"REC"** badge will appear in the top-left corner of the call. Jibri is now capturing audio and video.

### Step 3: Stop Recording
1. Click **`⋮` (More actions)** &rarr; **"Stop recording"**.
2. Confirm the stop prompt.

### Step 4: Access the MP4 File
Recordings are saved to the host at:
```bash
/home/saimon/Office/Jitsi/jitsi-cfg/storage/jibri/recordings/
```
Each recording session creates a folder containing the `.mp4` file and a `metadata.json` summary.

---

## 9. Troubleshooting & Common Pitfalls

### 1. "No recording option in the menu"
* **Check Moderator Status**: Check if you have the moderator star icon next to your name in the participants list. Non-moderator participants cannot see or trigger the recording button.
* **Test in a Fresh Room**: Open a newly named room (e.g. `https://meet.localhost/fresh-room-123`) so you are guaranteed to join as the first user and owner.
* **Check Jibri Status**: Verify Jibri is idle and available in Jicofo:
  ```bash
  docker exec jitsi-jibri-1 curl -s http://127.0.0.1:2222/jibri/api/v1.0/health
  # Should return: {"busyStatus":"IDLE","health":{"healthStatus":"HEALTHY"}}
  ```

### 2. "Audio is not audible in the recording"
* **Cause**: Chrome's Autoplay security policy blocks audio playback on automated pages unless specifically overridden.
* **Resolution**: Ensure `--autoplay-policy=no-user-gesture-required` is present in `CHROMIUM_FLAGS` inside `jitsi/.env`, then restart Jibri (`docker compose restart jibri`).

### 3. "Jibri fails to join the call on `meet.localhost`"
* **Cause**: Inside the Docker container, `meet.localhost` resolves to loopback (`127.0.0.1`) instead of the web container.
* **Resolution**: Ensure `--host-resolver-rules=MAP meet.localhost web:8443` is included in `CHROMIUM_FLAGS` in `jitsi/.env`.

---

## 10. Alternative Custom Recorder Bot (`recorder/`)

The repository also retains the custom, standalone recorder bot located in [`recorder/`](file:///home/saimon/Office/Jitsi/recorder/):
* **Technology**: Node.js, Playwright, Chromium, PulseAudio, Xvfb, FFmpeg.
* **Mechanism**: Joins conferences as a guest user triggered by an external REST API (`POST /recordings/start`).
* **Usage**: Can be operated independently if an external webhook or HTTP-driven recording flow is preferred over the native Jitsi Meet web UI.
