#!/usr/bin/env bash
set -e

echo "=== Initializing Recorder Bot Environment ==="

# 1. Start PulseAudio daemon in user/isolated mode
export PULSE_SERVER=unix:/tmp/pulse-socket
mkdir -p /tmp/pulse-runtime
chmod 700 /tmp/pulse-runtime

echo "Starting PulseAudio daemon..."
pulseaudio --kill 2>/dev/null || true
pulseaudio -D --exit-idle-time=-1 --disallow-exit --disallow-module-loading=0 --system=false

# Wait for PulseAudio
for i in {1..10}; do
  if pactl info >/dev/null 2>&1; then
    echo "✔ PulseAudio daemon is active."
    break
  fi
  sleep 0.5
done

# 2. Setup Virtual Null Sink
SINK_NAME="${PULSE_SINK_NAME:-jitsi_virtual_sink}"
echo "Setting up virtual null sink: $SINK_NAME..."
if ! pactl list sinks short | grep -q "$SINK_NAME"; then
  pactl load-module module-null-sink sink_name="$SINK_NAME" sink_properties=device.description="Jitsi_Virtual_Sink"
fi
pactl set-default-sink "$SINK_NAME"
export PULSE_SINK="$SINK_NAME"
export PULSE_SOURCE="${SINK_NAME}.monitor"
echo "✔ Default sink set to $SINK_NAME (Monitor: $PULSE_SOURCE)"

# 3. Setup Virtual Display (Xvfb)
export DISPLAY="${DISPLAY:-:99}"
export VIDEO_WIDTH="${VIDEO_WIDTH:-1920}"
export VIDEO_HEIGHT="${VIDEO_HEIGHT:-1080}"
echo "Starting Xvfb on DISPLAY=$DISPLAY (${VIDEO_WIDTH}x${VIDEO_HEIGHT}x24)..."

# Clean stale locks
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
Xvfb "$DISPLAY" -screen 0 "${VIDEO_WIDTH}x${VIDEO_HEIGHT}x24" -ac -nolisten tcp +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for Xvfb
for i in {1..10}; do
  if [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] || [ -f "/tmp/.X${DISPLAY#:}-lock" ]; then
    echo "✔ Xvfb virtual display is ready."
    break
  fi
  sleep 0.5
done

# Ensure recordings directory has write permissions
mkdir -p /recordings
mkdir -p /app/logs

echo "Starting Recorder API server on port ${PORT:-3000}..."
exec "$@"
