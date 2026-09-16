FROM mcr.microsoft.com/playwright:v1.49.1-jammy

# Avoid interactive prompts during apt
ENV DEBIAN_FRONTEND=noninteractive

# Install Xvfb, PulseAudio, FFmpeg, and diagnostic tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11-utils \
    pulseaudio \
    pulseaudio-utils \
    ffmpeg \
    procps \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# PulseAudio daemon settings for container usage
RUN echo "default-sample-format = float32le" >> /etc/pulse/daemon.conf && \
    echo "default-sample-rate = 48000" >> /etc/pulse/daemon.conf && \
    echo "default-sample-channels = 2" >> /etc/pulse/daemon.conf && \
    echo "exit-idle-time = -1" >> /etc/pulse/daemon.conf

WORKDIR /app

# Install Node.js dependencies
COPY package.json ./
RUN npm install --production

# Copy application source and entrypoint script
COPY src/ ./src/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create persistent mounts
RUN mkdir -p /recordings /app/logs

# Default runtime configuration
ENV DISPLAY=:99 \
    VIDEO_WIDTH=1920 \
    VIDEO_HEIGHT=1080 \
    VIDEO_FPS=30 \
    VIDEO_BITRATE=4M \
    AUDIO_BITRATE=128k \
    SEGMENT_DURATION_SEC=30 \
    PULSE_SINK_NAME=jitsi_virtual_sink \
    RECORDINGS_DIR=/recordings \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "src/api/server.js"]
