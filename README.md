# Self-Hosted Jitsi Meet & Custom Server-Side Recorder Bot

A completely local, self-hosted Jitsi Meet environment on Linux paired with a custom server-side recording bot built from scratch using **Chromium**, **Playwright**, **Xvfb**, **PulseAudio**, and **FFmpeg**.

> **Note**: This solution does **NOT** use Jibri and does **NOT** use Vexa. It captures both remote conference video and audio directly on the server without client extensions or host-side screen capture.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Prerequisites & Host Requirements](#2-prerequisites--host-requirements)
3. [Repository Structure](#3-repository-structure)
4. [Self-Hosted Jitsi Meet Setup (Phase 2)](#4-self-hosted-jitsi-meet-setup-phase-2)
5. [Recorder Bot Service (Phases 3–11)](#5-recorder-bot-service-phases-311)
6. [Audio & Video Capture Pipeline (Phases 4, 5, 8, 9)](#6-audio--video-capture-pipeline-phases-4-5-8-9)
7. [Authentication Modes (Phase 7)](#7-authentication-modes-phase-7)
8. [Recording State Machine (Phase 10)](#8-recording-state-machine-phase-10)
9. [REST API Reference (Phase 11)](#9-rest-api-reference-phase-11)
10. [Local Storage & File Naming (Phase 12)](#10-local-storage--file-naming-phase-12)
11. [Health Checks & Watchdog (Phase 13)](#11-health-checks--watchdog-phase-13)
12. [Host Power-Loss Test (Phase 14)](#12-host-power-loss-test-phase-14)
13. [Failure Scenarios & Recovery Matrix (Phase 15)](#13-failure-scenarios--recovery-matrix-phase-15)
14. [Idempotency & Security (Phases 16 & 17)](#14-idempotency--security-phases-16--17)
15. [Resource Control & Limits (Phase 18)](#15-resource-control--limits-phase-18)
16. [Load Testing Plan: 5 to 500 Participants (Phase 19)](#16-load-testing-plan-5-to-500-participants-phase-19)
17. [Observability & Metrics (Phase 20)](#17-observability--metrics-phase-20)
18. [Automated Local Demo Scripts (Phase 21)](#18-automated-local-demo-scripts-phase-21)
19. [Troubleshooting](#19-troubleshooting)
20. [Production Deployment Considerations](#20-production-deployment-considerations)

---

## 1. High-Level Architecture

```
                               LOCAL LINUX HOST
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                                                                             │
 │                           JITSI MEET CLUSTER                                │
 │                                                                             │
 │   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────┐   │
 │   │   Prosody    │◄───►│    Jicofo    │◄───►│     JVB      │◄───►│ Web  │   │
 │   │ (XMPP Core)  │     │ (Focus Mgmt) │     │ (Videobridge)│     │(Nginx│   │
 │   └──────────────┘     └──────────────┘     └──────────────┘     └──────┘   │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ WebRTC Audio / Video
                                        ▼
                  ┌───────────────────────────────────────────┐
                  │              Jitsi Room                   │
                  │   https://meet.localhost/<meeting-id>     │
                  └───────┬───────────────────────────┬───────┘
                          │                           │
                 Human Participants             Recorder Bot
            (Teacher, Student 1, Student 2)     "Course Recorder"
                                                      │
         ┌────────────────────────────────────────────┴────────────────────────────────┐
         │                         RECORDER BOT CONTAINER                              │
         │                                                                             │
         │  ┌───────────────────────┐                                                  │
         │  │   Playwright Core     │ Controls Chromium to join room as muted guest    │
         │  └──────────┬────────────┘                                                  │
         │             │                                                               │
         │             ▼                                                               │
         │  ┌───────────────────────┐                                                  │
         │  │   Chromium (kiosk)    │ Fullscreen rendered to virtual frame buffer      │
         │  └──────────┬────────────┘                                                  │
         │             │                                                               │
         │      ┌──────┴───────────────────────┐                                       │
         │      │ Video Display                │ Audio Output                          │
         │      ▼                              ▼                                       │
         │  ┌───────────────────────┐      ┌────────────────────────┐                  │
         │  │  Xvfb (DISPLAY=:99)   │      │ PulseAudio Virtual     │                  │
         │  │  1920x1080x24         │      │ Sink (null-sink)       │                  │
         │  └──────────┬────────────┘      └───────────┬────────────┘                  │
         │             │                               │                               │
         │             │ X11 screen grab               │ Monitor source capture        │
         │             │ (-f x11grab)                  │ (-f pulse -i sink.monitor)    │
         │             └──────────────┬────────────────┘                               │
         │                            ▼                                                │
         │                 ┌──────────────────────┐                                    │
         │                 │   FFmpeg Pipeline    │ H.264 (4M) + AAC (128k)            │
         │                 └──────────┬───────────┘                                    │
         │                            │                                                │
         │                            ▼                                                │
         │                 ┌──────────────────────┐                                    │
         │                 │ Segmented Muxer      │ segment-0000.mp4, 0001.mp4...      │
         │                 └──────────┬───────────┘                                    │
         │                            │ On Stop: Lossless Concat Remux                 │
         │                            ▼                                                │
         │                 ┌──────────────────────┐                                    │
         │                 │      final.mp4       │ Synchronized Master MP4            │
         │                 └──────────┬───────────┘                                    │
         └────────────────────────────┼────────────────────────────────────────────────┘
                                      ▼
                        /recordings/<meeting-id>/
```

---

## 2. Prerequisites & Host Requirements

### Hardware Requirements (Local Development / Testing)
- **CPU**: 4+ cores recommended (AMD Ryzen 9 8945HX 32 threads tested)
- **RAM**: 8+ GB total, with at least 4 GB free
- **Storage**: At least 5 GB free for local recordings and Docker layers
- **OS**: Linux (tested on Linux Mint 22.3 / Ubuntu 24.04 noble, kernel 7.0.0-31)

### Software Dependencies
- Docker Engine 24+ (Docker 29.8.0 tested)
- Docker Compose plugin v2+ (Docker Compose v5.5.1 tested)
- `curl`

### Running the Environment Audit
Run the included Phase 1 audit script:
```bash
./check-environment.sh
```
The script verifies operating system, CPU cores, RAM, free disk space, Docker daemon status, Compose version, and audio subsystems.

---

## 3. Repository Structure

```
/home/saimon/Office/Jitsi/
├── check-environment.sh        # Phase 1: Host dependency and resource audit script
├── start-demo.sh               # Phase 21: One-command automated demo startup
├── test-recorder.sh            # Phase 21: Automated recording verification script
├── simulate-host-disconnect.sh # Phase 14: Automated host abrupt disconnect & rejoin test
├── .gitignore                  # Gitignore protecting secrets and recordings
├── README.md                   # This master documentation
├── jitsi/                      # Jitsi Meet official Docker setup (stable-11248)
│   ├── .env                    # Jitsi environment configuration
│   ├── docker-compose.yml      # Jitsi services (web, prosody, jicofo, jvb)
│   └── gen-passwords.sh        # Secret password generator
├── jitsi-cfg/                  # Persistent host configurations for Jitsi components
│   ├── web/                    # Nginx SSL certs and web configs
│   ├── prosody/                # Prosody XMPP configs and accounts
│   ├── jicofo/                 # Focus component configs
│   └── jvb/                    # Videobridge configs
└── recorder/                   # Custom Recorder Service
    ├── Dockerfile              # Playwright + Chromium + Xvfb + PulseAudio + FFmpeg
    ├── docker-compose.yml      # Container definition with resource limits & host network
    ├── package.json            # Node.js dependencies
    ├── entrypoint.sh           # In-container initialization of PulseAudio, Xvfb, API
    ├── .env                    # Recorder environment variables
    ├── .env.example            # Recorder configuration template
    ├── src/
    │   ├── api/
    │   │   └── server.js       # Express REST API (auth, idempotency, metrics)
    │   ├── worker/
    │   │   └── recorder.js     # RecordingWorker lifecycle & crash watchdog
    │   ├── browser/
    │   │   └── jitsi.js        # Playwright Jitsi bot automation
    │   ├── capture/
    │   │   ├── display.js      # Xvfb virtual display manager
    │   │   └── audio.js        # PulseAudio virtual null-sink manager
    │   ├── ffmpeg/
    │   │   └── recorder.js     # FFmpeg command generator & concat demuxer
    │   ├── storage/
    │   │   └── filesystem.js   # Disk storage & segment file manager
    │   ├── state/
    │   │   └── state-manager.js# Formal state machine & state.json persistence
    │   └── scripts/
    │       └── simulate-host-disconnect.js # Phase 14 test runner
    ├── recordings/             # Host directory where MP4s are saved
    └── logs/                   # Service log output
```

---

## 4. Self-Hosted Jitsi Meet Setup (Phase 2)

### DNS Resolution
The Jitsi stack uses `meet.localhost`. In modern Linux distributions with `systemd-resolved` (Ubuntu, Mint, Debian, Arch, Fedora), any `*.localhost` domain automatically resolves to `127.0.0.1` and `::1`.

If your environment does not support automatic RFC 6761 localhost resolution, add to `/etc/hosts`:
```text
127.0.0.1 meet.localhost
```

### Jitsi Configuration Values (`jitsi/.env`)
Key configuration values implemented in `jitsi/.env`:

| Key | Value | Purpose |
|-----|-------|---------|
| `CONFIG` | `/home/saimon/Office/Jitsi/jitsi-cfg` | Keeps config files within the project directory |
| `HTTP_PORT` | `80` | Standard HTTP port (redirects to HTTPS) |
| `HTTPS_PORT` | `443` | Standard HTTPS port for clean meeting URLs |
| `PUBLIC_URL` | `https://meet.localhost` | Root public URL advertised to clients |
| `JVB_PORT` | `10000` | UDP media port for WebRTC audio/video |
| `JVB_COLIBRI_PORT`| `8088` | Relocated Colibri port to avoid host port 8080 conflict |
| `JVB_ADVERTISE_IPS`| `127.0.0.1,192.168.0.107` | Advertised IPs for local WebRTC candidates |
| `ENABLE_AUTO_OWNER`| `true` | Automatically elects new owner if host disconnects |
| `ENABLE_END_CONFERENCE`| `false`| Prevents automatic meeting destruction on host exit |
| `JICOFO_CONF_SINGLE_PARTICIPANT_TIMEOUT`| `60m`| Keeps room active for 60 minutes even if 1 user left |
| `JITSI_IMAGE_REPO` | `ghcr.io/jitsi` | Official GitHub Container Registry |
| `JITSI_IMAGE_VERSION` | `stable-11248` | Stable Jitsi release |

### Starting Jitsi
```bash
cd /home/saimon/Office/Jitsi/jitsi
docker compose up -d web prosody jicofo jvb
```

Verify that Jitsi responds:
```bash
curl -k -IL https://meet.localhost/
```
Expected output: `HTTP/2 200`.

---

## 5. Recorder Bot Service (Phases 3–11)

The recorder bot is completely decoupled from Jitsi:
- It connects as a regular client via WebRTC over the local network interface.
- It renders in its own isolated Xvfb virtual display (`:99`).
- It plays audio to an isolated PulseAudio virtual null-sink.
- It encodes using FFmpeg without touching any physical microphone or speakers.

### Configuration Options (`recorder/.env`)

```ini
PORT=3000
RECORDER_API_KEY=local-dev-secret-key-123
DISPLAY=:99
VIDEO_WIDTH=1920
VIDEO_HEIGHT=1080
VIDEO_FPS=30
VIDEO_BITRATE=4M
AUDIO_BITRATE=128k
SEGMENT_DURATION_SEC=30
PULSE_SINK_NAME=jitsi_virtual_sink
RECORDINGS_DIR=/recordings
MIN_DISK_SPACE_MB=1024
BOT_DISPLAY_NAME=Course Recorder
```

### Starting the Recorder Service
```bash
cd /home/saimon/Office/Jitsi/recorder
docker compose up -d
```

---

## 6. Audio & Video Capture Pipeline (Phases 4, 5, 8, 9)

### Video Pipeline (Phase 4)
- **Display Server**: Xvfb running on `:99` with resolution `1920x1080` and 24-bit color depth.
- **Browser**: Chromium launched by Playwright with `--kiosk`, `--window-size=1920,1080`, and `--window-position=0,0`.
- **Capture Source**: `-f x11grab -draw_mouse 0 -video_size 1920x1080 -framerate 30 -i :99.0`.

### Audio Pipeline (Phase 5)
```
Conference Audio Stream
         │
         ▼
Chromium Browser (PULSE_SINK=jitsi_virtual_sink)
         │
         ▼
PulseAudio Virtual Null Sink (`module-null-sink`)
         │
         ▼
Monitor Source (`jitsi_virtual_sink.monitor`)
         │
         ▼
FFmpeg Input (`-f pulse -i jitsi_virtual_sink.monitor`)
```

### FFmpeg Encoding Pipeline (Phase 8)
Generated FFmpeg command:
```bash
ffmpeg -y -hide_banner -loglevel info \
  -thread_queue_size 1024 \
  -f x11grab -draw_mouse 0 -video_size 1920x1080 -framerate 30 -i :99.0 \
  -thread_queue_size 1024 \
  -f pulse -i jitsi_virtual_sink.monitor \
  -c:v libx264 -preset veryfast -b:v 4M -maxrate 4M -bufsize 8M \
  -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -b:a 128k -ar 48000 -af aresample=async=1 \
  -f segment -segment_time 30 -segment_format mp4 -reset_timestamps 1 -segment_list_type flat \
  /recordings/<meeting_id>/segment-%04d.mp4
```

### Segmented Recording & Final Concatenation (Phase 9)
1. Rather than running a monolithic multi-hour FFmpeg process, the bot cuts segments at keyframe boundaries (`segment-0000.mp4`, `segment-0001.mp4`, ...).
2. If FFmpeg or the browser crashes, existing segments remain 100% playable.
3. On meeting stop:
   - Each segment is inspected with `ffprobe` for valid audio and video tracks.
   - Any corrupt trailing fragments are discarded.
   - Valid segments are remuxed into `final.mp4` via the FFmpeg Concat Demuxer without re-encoding:
     ```bash
     ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy -movflags +faststart final.mp4
     ```

---

## 7. Authentication Modes (Phase 7)

The recorder bot supports three authentication modes:

### 1. Development Public Mode (Default)
Any user can create and join rooms without credentials. The bot joins directly.

### 2. Password-Protected Rooms
When a room has a lobby/password protection set, pass the password in the API call:
```json
{
  "meeting_id": "math-101",
  "room_url": "https://meet.localhost/math-101",
  "password": "SecretRoomPassword"
}
```
The Playwright bot detects the password input modal (`input[data-testid="password-input"]`) and enters the credentials automatically.

### 3. JWT-Authenticated Rooms (Production)
In production, Prosody is configured with `ENABLE_AUTH=1` and `AUTH_TYPE=jwt`.
Pass the signed JWT in the request:
```json
{
  "meeting_id": "math-101",
  "room_url": "https://meet.localhost/math-101",
  "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
The bot appends `?jwt=<token>` to the room URL securely without exposing secrets to frontend code.

---

## 8. Recording State Machine (Phase 10)

The recording lifecycle follows a formal state machine persisted in `/recordings/<meeting-id>/state.json`:

```
               ┌──────────┐
               │ PENDING  │
               └────┬─────┘
                    │
                    ▼
               ┌──────────┐
         ┌────►│ STARTING │
         │     └────┬─────┘
         │          │
         │          ▼
         │     ┌──────────┐
         │     │ JOINING  │◄────────────┐
         │     └────┬─────┘             │
         │          │                   │
         │          ▼                   │
         │     ┌───────────┐      ┌────────────┐
         │     │ RECORDING │◄────►│ RECOVERING │
         │     └────┬──────┘      └────────────┘
         │          │
         │          ▼
         │     ┌──────────┐
         │     │ STOPPING │
         │     └────┬─────┘
         │          │
         │          ▼
         │     ┌────────────┐
         │     │ PROCESSING │
         │     └────┬───────┘
         │          │
         │          ▼
         │     ┌───────────┐
         │     │ COMPLETED │
         │     └───────────┘
         │
         ▼
   ┌───────────┐
   │  FAILED   │ (or CANCELLED)
   └───────────┘
```

If Chromium or FFmpeg crashes during the `RECORDING` state:
1. State changes to `RECOVERING`.
2. Watchdog cleans stale handles and restarts the component.
3. Transitions back to `JOINING` (if browser died) or restarts FFmpeg (if encoder died).
4. Returns to `RECORDING` once confirmed healthy.

---

## 9. REST API Reference (Phase 11)

All control endpoints require the header `X-API-Key: local-dev-secret-key-123` or `Authorization: Bearer <key>`.

### 1. Start Recording
`POST /recordings/start`

**Request Body:**
```json
{
  "meeting_id": "demo-class",
  "room_url": "https://meet.localhost/demo-class",
  "display_name": "Course Recorder",
  "jwt": null,
  "password": null
}
```

**Response (202 Accepted):**
```json
{
  "recording_id": "rec_1773644500000_a1b2c3d4",
  "meeting_id": "demo-class",
  "room_url": "https://meet.localhost/demo-class",
  "status": "STARTING",
  "message": "Recorder bot is starting and joining the conference."
}
```

### 2. Stop Recording
`POST /recordings/:id/stop`

**Response (200 OK):**
```json
{
  "recording_id": "rec_1773644500000_a1b2c3d4",
  "status": "COMPLETED",
  "final_file": "/recordings/demo-class/final.mp4",
  "stats": {
    "duration_seconds": 45.2,
    "file_size_bytes": 24117248,
    "video_streams": 1,
    "audio_streams": 1,
    "resolution": "1920x1080"
  },
  "message": "Recording stopped and processed."
}
```

### 3. Get Recording Status
`GET /recordings/:id/status`

**Response (200 OK):**
```json
{
  "recording_id": "rec_1773644500000_a1b2c3d4",
  "meeting_id": "demo-class",
  "status": "RECORDING",
  "health": {
    "is_recording": true,
    "browser_connected": true,
    "free_disk_mb": 145200,
    "segment_count": 2,
    "recovery_attempts": 0
  }
}
```

### 4. Health Probe
`GET /health` (No authentication required)

### 5. Metrics Counters
`GET /metrics` (No authentication required)

Returns counters for: `recordings_started`, `recordings_completed`, `recordings_failed`, `recordings_stopped`, `browser_restarts`, `ffmpeg_restarts`, and `segments_created`.

---

## 10. Local Storage & File Naming (Phase 12)

Recordings are written to `/recordings/<meeting-id>/` inside the container, mounted to `recorder/recordings/<meeting-id>/` on the host:

```
recorder/recordings/
└── demo-class/
    ├── segment-0000.mp4
    ├── segment-0001.mp4
    ├── segment-0002.mp4
    ├── state.json
    └── final.mp4
```

---

## 11. Health Checks & Watchdog (Phase 13)

The `RecordingWorker` runs a continuous watchdog loop every 3 seconds:
- **Process Check**: Confirms FFmpeg is active.
- **File Growth Check**: Verifies that the latest segment file size increases. If file growth stalls for 15+ seconds, a warning is raised.
- **Disk Safety**: If free disk drops below `500 MB`, an emergency stop is triggered to prevent filesystem exhaustion.
- **Connection Check**: Monitors `window.APP.conference.isJoined()`. If false, triggers recovery.

---

## 12. Host Power-Loss Test (Phase 14)

### Scenario Description
1. Teacher starts meeting `https://meet.localhost/powerloss-class`.
2. Student 1 and Student 2 join the room.
3. Recorder bot joins as "Course Recorder" and begins recording.
4. After 10 seconds of class activity, the Teacher's laptop loses power / internet (browser process killed abruptly without hangup).
5. **Observed Behavior**:
   - The Jitsi Videobridge and Prosody maintain the conference room.
   - Student 1 and Student 2 remain connected.
   - The Recorder Bot remains connected and records continuously.
6. Teacher powers on, reconnects, and rejoins the **same** Jitsi room URL.
7. Teacher media streams resume.
8. Recording is finalized.
9. **Final MP4 Output**: Contains the teacher's initial instruction, the intermediate period where students converse in the teacher's absence, and the teacher's re-entry.

### Running the Test
```bash
./simulate-host-disconnect.sh
```

---

## 13. Failure Scenarios & Recovery Matrix (Phase 15)

| # | Failure Scenario | Expected System Behavior | Recovery Mechanism | Log Signature | Resulting State |
|---|------------------|--------------------------|--------------------|---------------|-----------------|
| 1 | Host browser closes | Room remains active for remaining participants | Prosody keeps MUC alive; Jicofo respects timeout | `[jitsi] participant_left` | `RECORDING` continues |
| 2 | Host computer powers off | WebRTC timeout detects lost media; room stays open | No hangup packet needed; JVB drops dead SSRC | `[jicofo] participant_timeout` | `RECORDING` continues |
| 3 | Host internet drops | Same as power loss | Room persists for other users and recorder | `[jvb] Endpoint disconnected` | `RECORDING` continues |
| 4 | Host reconnects | Host joins existing room with new SSRC | Jicofo re-negotiates SDP; JVB forwards video | `[jicofo] participant_joined` | `RECORDING` continues |
| 5 | Recorder Chromium crashes | Page crash event fired | Worker transitions to `RECOVERING`, relaunches Chromium, rejoins | `[browser.crashed] Chromium page crashed` | `RECOVERING` -> `RECORDING` |
| 6 | FFmpeg process crashes | FFmpeg exit handler triggered | Worker saves existing segments, spawns new FFmpeg instance | `[ffmpeg.exited] code != 0` | `RECOVERING` -> `RECORDING` |
| 7 | Recorder service restarts | Container restarts via Docker restart policy | Old segments preserved on disk; API re-listens | `[api.started]` | Previous file preserved |
| 8 | Jitsi bridge disconnects | Bot detects `isJoined() == false` | Bot triggers reconnect attempt; FFmpeg keeps recording | `[jitsi.disconnected]` | `RECOVERING` -> `RECORDING` |
| 9 | Temporary network glitch | WebRTC ICE restart triggered | Chromium reconnects automatically | `[browser.console] ICE restart` | `RECORDING` |
| 10 | Disk nearly full (<500MB) | Emergency stop triggered | Stops FFmpeg gracefully, remuxes existing segments | `[watchdog.disk_critical]` | `STOPPING` -> `COMPLETED` |
| 11 | Stop called twice | Idempotent response | Returns existing final MP4 metadata or 404 | `[worker.stop] Already stopping` | `COMPLETED` |
| 12 | Start called twice | Idempotent response (Phase 16) | Returns active recording ID without duplicate bot | `[idempotency.hit]` | `RECORDING` |
| 13 | Meeting ends unexpectedly | Bot detects empty room after timeout | Watchdog or timeout cleans up recording | `[jitsi.poll] 0 participants` | `STOPPING` -> `COMPLETED` |

---

## 14. Idempotency & Security (Phases 16 & 17)

- **Idempotency**: If `POST /recordings/start` is called multiple times for the same `meeting_id`, the API returns the active recording object with HTTP 200 instead of spawning duplicate Chromium/FFmpeg instances.
- **Security**:
  - API secret keys and JWT secrets are stored exclusively in `.env`.
  - Frontend users never receive secrets.
  - Path traversal is blocked in `filesystem.js` using `meetingId.replace(/[^a-zA-Z0-9_-]/g, '_')`.

---

## 15. Resource Control & Limits (Phase 18)

Running Jitsi and the recorder on the same host can lead to resource contention if uncontrolled. We enforce strict cgroup resource constraints in `recorder/docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '4.0'
      memory: 4096M
    reservations:
      cpus: '1.0'
      memory: 1024M
```

- **Chromium Optimizations**: `--disable-dev-shm-usage`, `--disable-gpu`, `--no-sandbox`.
- **FFmpeg Bitrate Caps**: 4 Mbps video (CBR-like with `maxrate 4M -bufsize 8M`) preventing runaway disk growth.

---

## 16. Load Testing Plan: 5 to 500 Participants (Phase 19)

> **Important**: Do not attempt to run 500 video participants on a single development laptop. The following 5-stage staged plan must be executed systematically:

| Stage | Participants | Expected Jitsi CPU | Expected Recorder CPU | Total Host RAM | Network In/Out | Test Duration |
|-------|--------------|-------------------|-----------------------|----------------|----------------|---------------|
| **1** | 5 users + bot | ~10% (1-2 cores) | ~15% (1.5 cores) | ~3 GB | ~15 Mbps | 30 minutes |
| **2** | 25 users + bot| ~25% (4 cores) | ~20% (2 cores) | ~5 GB | ~80 Mbps | 1 hour |
| **3** | 100 users + bot| ~50% (8 cores) | ~25% (2.5 cores) | ~8 GB | ~300 Mbps | 2 hours |
| **4** | 250 users + bot| ~80% (16 cores) | ~30% (3 cores) | ~16 GB | ~800 Mbps | 3 hours |
| **5** | 500 users + bot| Distributed JVB pool | Dedicated Node | 32+ GB | 1.5+ Gbps | 3 hours |

### Execution Instructions (using `jitsi-bench` or headless bots)
```bash
# Example Stage 1: Spawn 5 virtual users sending test synthetic streams
# Monitor metrics during execution:
docker stats
```

---

## 17. Observability & Metrics (Phase 20)

### Structured Log Format
Logs are emitted in standard ISO format:
```text
2026-09-16T13:00:01.123Z [worker.start] Initializing recording worker for meeting: demo-class
2026-09-16T13:00:03.456Z [browser.launched] Chromium ready.
2026-09-16T13:00:06.789Z [jitsi.joined] Recorder bot successfully joined conference as 'Course Recorder'
2026-09-16T13:00:07.123Z [ffmpeg.started] FFmpeg recording pipeline active.
2026-09-16T13:00:37.456Z [ffmpeg.segment.opening] Opening '/recordings/demo-class/segment-0001.mp4'
2026-09-16T13:01:00.000Z [worker.stopping] Stopping recording for meeting: demo-class
2026-09-16T13:01:02.123Z [ffmpeg.concat.completed] Final file produced: /recordings/demo-class/final.mp4
```

---

## 18. Automated Local Demo Scripts (Phase 21)

### 1. Launch Demo Stack
```bash
./start-demo.sh
```
This script audits the machine, starts Jitsi, starts the recorder bot service, waits for health checks, and prints URLs and curl examples.

### 2. Run Automated Verification Test
```bash
./test-recorder.sh
```
Triggers a live recording, monitors segment creation, stops the recording, probes the final MP4 with `ffprobe`, and verifies that both H.264 video and AAC audio are synchronized and playable.

### 3. Run Host Power-Loss Simulation
```bash
./simulate-host-disconnect.sh
```
Simulates a live classroom with teacher and students, terminates the teacher unexpectedly, confirms conference and recording continuity, rejoins the teacher, and verifies the final recording.

---

## 19. Troubleshooting

### 1. "curl: (60) SSL certificate problem: self-signed certificate"
Jitsi generates a self-signed certificate in development mode.
- Use `curl -k` or `--insecure`.
- Chromium is configured with `--ignore-certificate-errors` and `--allow-running-insecure-content`.

### 2. "Port 8080 already in use"
If another container (e.g. phpMyAdmin) is bound to 8080, Jitsi's `JVB_COLIBRI_PORT` has been configured to `8088` in `jitsi/.env` to prevent port collisions.

### 3. Audio Not Heard in Final Video
Verify that the PulseAudio virtual null-sink is loaded:
```bash
docker compose -f recorder/docker-compose.yml exec recorder pactl list sinks short
```
The output must show `jitsi_virtual_sink`.

---

## 20. Production Deployment Considerations

1. **Decouple Recorder onto Dedicated Nodes**: For production scale (50+ rooms), deploy the recorder bot service on dedicated compute worker nodes with GPU-accelerated video encoding (NVENC / QuickSync) to offload CPU.
2. **Valid TLS**: Replace self-signed certs with Let's Encrypt (`ENABLE_LETSENCRYPT=1`) or reverse proxy behind AWS ALB / Cloudflare.
3. **S3 / Cloud Storage Upload**: In `worker/recorder.js`, integrate an S3 upload step in `PROCESSING` state before marking `COMPLETED`.
4. **JWT Security**: Issue short-lived JWT tokens signed with `JWT_APP_SECRET` for both human moderators and the recorder bot.
