# Custom Jitsi Server-Side Recording Bot

A lightweight, robust, containerized recorder bot that joins Jitsi Meet conferences as a virtual participant and captures synchronized 1080p video and audio using **Chromium**, **Playwright**, **Xvfb**, **PulseAudio**, and **FFmpeg**.

---

## Features

- **No Jibri / No Vexa**: Independent, Linux-native custom pipeline.
- **Server-Side Audio & Video**: Captures remote audio from PulseAudio virtual sink and video from Xvfb display.
- **Segmented Recording**: Captures directly to MP4 segments (`segment-0000.mp4`, ...) for failure resilience.
- **Lossless Concat**: On stop, segments are validated with `ffprobe` and remuxed into `final.mp4` with zero quality loss.
- **State Machine**: Formal lifecycle transitions persisted to `state.json`.
- **Health Watchdog**: Monitors process health, file size growth, and free disk space every 3 seconds.
- **Automatic Recovery**: Relaunches browser and rejoins Jitsi if page crashes.
- **REST API**: Simple HTTP interface with API key security and idempotency protection.

---

## Directory Structure

```
recorder/
├── src/
│   ├── api/server.js            # Express API server (endpoints, auth, metrics)
│   ├── worker/recorder.js       # Recording worker lifecycle & watchdog
│   ├── browser/jitsi.js         # Playwright automation for Jitsi Meet
│   ├── capture/display.js       # Xvfb virtual display manager
│   ├── capture/audio.js         # PulseAudio virtual sink & monitor manager
│   ├── ffmpeg/recorder.js       # FFmpeg command builder, segmenter & concat demuxer
│   ├── storage/filesystem.js    # Recording files and disk space monitor
│   ├── state/state-manager.js   # State machine & state.json persistence
│   └── scripts/
│       └── simulate-host-disconnect.js # Host power-loss scenario simulation
├── recordings/                  # Output directory for segments and final.mp4
├── logs/                        # Application logs
├── Dockerfile                   # Multi-stage image definition
├── docker-compose.yml           # Host-networked container with resource constraints
├── entrypoint.sh                # Boots PulseAudio null-sink and Xvfb display
└── package.json                 # Node.js dependencies
```

---

## Configuration (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP API listening port |
| `RECORDER_API_KEY` | `local-dev-secret-key-123` | Security key for `X-API-Key` header |
| `DISPLAY` | `:99` | Virtual X11 display number |
| `VIDEO_WIDTH` | `1920` | Capture width |
| `VIDEO_HEIGHT` | `1080` | Capture height |
| `VIDEO_FPS` | `30` | Frame rate |
| `VIDEO_BITRATE` | `4M` | Target H.264 video bitrate |
| `AUDIO_BITRATE` | `128k` | Target AAC audio bitrate |
| `SEGMENT_DURATION_SEC` | `30` | Duration of each recorded segment |
| `PULSE_SINK_NAME` | `jitsi_virtual_sink` | Virtual null-sink name |
| `RECORDINGS_DIR` | `/recordings` | Internal recordings path |
| `MIN_DISK_SPACE_MB` | `1024` | Safety disk limit before emergency stop |
| `BOT_DISPLAY_NAME` | `Course Recorder` | Bot display name shown in Jitsi Meet |

---

## Running Standalone

### With Docker Compose
```bash
docker compose up -d
```

### Checking Container Health
```bash
curl http://localhost:3000/health
```

### Checking Metrics
```bash
curl http://localhost:3000/metrics
```

---

## API Usage Examples

### 1. Start Recording
```bash
curl -X POST http://localhost:3000/recordings/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-secret-key-123" \
  -d '{
    "meeting_id": "cs50-lecture",
    "room_url": "https://meet.localhost/cs50-lecture"
  }'
```

### 2. Query Status
```bash
curl -s http://localhost:3000/recordings/<RECORDING_ID>/status \
  -H "X-API-Key: local-dev-secret-key-123"
```

### 3. Stop Recording
```bash
curl -X POST http://localhost:3000/recordings/<RECORDING_ID>/stop \
  -H "X-API-Key: local-dev-secret-key-123"
```
The response returns the path to `final.mp4` and audio/video stream verification stats.
