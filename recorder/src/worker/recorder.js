import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DisplayManager } from '../capture/display.js';
import { AudioManager } from '../capture/audio.js';
import { JitsiBot } from '../browser/jitsi.js';
import { FFmpegRecorder } from '../ffmpeg/recorder.js';
import { StateManager, RecordingStates } from '../state/state-manager.js';
import { StorageManager } from '../storage/filesystem.js';

export class RecordingWorker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.recordingId = options.recordingId;
    this.meetingId = options.meetingId;
    this.roomUrl = options.roomUrl;
    this.displayName = options.displayName || process.env.BOT_DISPLAY_NAME || 'Course Recorder';
    this.jwt = options.jwt || null;
    this.roomPassword = options.roomPassword || null;

    this.storage = new StorageManager();
    this.meetingDir = this.storage.getMeetingDir(this.meetingId);
    this.stateFilePath = this.storage.getStateFilePath(this.meetingId);

    this.state = new StateManager(this.stateFilePath, {
      recording_id: this.recordingId,
      meeting_id: this.meetingId,
      room_url: this.roomUrl,
      display_name: this.displayName
    });

    this.display = new DisplayManager();
    this.audio = new AudioManager();
    this.bot = null;
    this.ffmpeg = null;

    this.watchdogTimer = null;
    this.lastWatchdogCheck = Date.now();
    this.lastFileSize = 0;
    this.stalledSeconds = 0;
    this.isStopping = false;
  }

  async start() {
    try {
      console.log(`${new Date().toISOString()} [worker.start] Initializing recording worker for meeting: ${this.meetingId}`);
      this.state.transition(RecordingStates.STARTING);

      // Check disk space
      this.storage.checkDiskSpace(parseInt(process.env.MIN_DISK_SPACE_MB || '1024', 10));

      // 1. Setup Virtual Display (Xvfb)
      await this.display.start();

      // 2. Setup Virtual Audio (PulseAudio null-sink)
      await this.audio.setup();

      // 3. Launch Browser and Join Jitsi Room
      this.state.transition(RecordingStates.JOINING);
      await this.initAndJoinBot();

      // 4. Start FFmpeg Recording Pipeline
      await this.initAndStartFFmpeg();

      // 5. Transition to RECORDING
      this.state.transition(RecordingStates.RECORDING);

      // 6. Start Watchdog / Health Check
      this.startWatchdog();

      console.log(`${new Date().toISOString()} [worker.recording] Worker successfully in RECORDING state.`);
    } catch (err) {
      console.error(`${new Date().toISOString()} [worker.error] Error starting recording worker:`, err);
      this.state.transition(RecordingStates.FAILED, { error: err.message });
      await this.cleanup();
      throw err;
    }
  }

  async initAndJoinBot() {
    if (this.bot) {
      await this.bot.close().catch(() => {});
    }

    this.bot = new JitsiBot({
      roomUrl: this.roomUrl,
      displayName: this.displayName,
      display: this.display.display,
      width: this.display.width,
      height: this.display.height,
      jwt: this.jwt,
      roomPassword: this.roomPassword
    });

    this.bot.on('crashed', async (err) => {
      console.error(`${new Date().toISOString()} [worker.bot.crashed] Jitsi bot crashed:`, err);
      if (!this.isStopping && this.state.state.status === RecordingStates.RECORDING) {
        await this.handleCrashRecovery('browser');
      }
    });

    this.bot.on('disconnected', async () => {
      console.warn(`${new Date().toISOString()} [worker.bot.disconnected] Jitsi bot disconnected.`);
      if (!this.isStopping && this.state.state.status === RecordingStates.RECORDING) {
        await this.handleCrashRecovery('jitsi_reconnect');
      }
    });

    await this.bot.launch();
    await this.bot.join();
  }

  async initAndStartFFmpeg() {
    if (this.ffmpeg) {
      await this.ffmpeg.stop().catch(() => {});
    }

    const outputPattern = this.storage.getSegmentPattern(this.meetingId);
    const finalPath = this.storage.getFinalRecordingPath(this.meetingId);

    this.ffmpeg = new FFmpegRecorder({
      display: this.display.display,
      audioSource: this.audio.getMonitorSource(),
      outputPattern: outputPattern,
      meetingDir: this.meetingDir,
      finalPath: finalPath
    });

    this.ffmpeg.on('stopped', async ({ code, signal }) => {
      if (!this.isStopping && this.state.state.status === RecordingStates.RECORDING) {
        console.warn(`${new Date().toISOString()} [worker.ffmpeg.crashed] FFmpeg exited unexpectedly with code ${code}!`);
        await this.handleCrashRecovery('ffmpeg');
      }
    });

    await this.ffmpeg.start();
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);

    this.watchdogTimer = setInterval(async () => {
      if (this.isStopping) return;

      try {
        // 1. Check FFmpeg process
        if (!this.ffmpeg || !this.ffmpeg.isRecording) {
          console.warn(`${new Date().toISOString()} [watchdog] FFmpeg is not recording! Initiating recovery...`);
          await this.handleCrashRecovery('ffmpeg');
          return;
        }

        // 2. Check current output file growth
        const segments = this.storage.listSegments(this.meetingId);
        if (segments.length > 0) {
          const latestSegment = segments[segments.length - 1];
          try {
            const stat = fs.statSync(latestSegment);
            if (stat.size === this.lastFileSize) {
              this.stalledSeconds += 3;
              if (this.stalledSeconds >= 15) {
                console.warn(`${new Date().toISOString()} [watchdog] Output file size stalled for ${this.stalledSeconds}s on ${path.basename(latestSegment)}!`);
              }
            } else {
              this.stalledSeconds = 0;
              this.lastFileSize = stat.size;
            }
          } catch {}
        }

        // 3. Check Disk Space
        const freeMB = this.storage.getFreeDiskSpaceMB();
        if (freeMB > 0 && freeMB < 500) {
          console.error(`${new Date().toISOString()} [watchdog.disk_critical] Less than 500MB disk space remaining! Emergency stopping...`);
          await this.stop('Disk space depleted');
        }
      } catch (err) {
        console.warn(`${new Date().toISOString()} [watchdog.error] Notice in watchdog check:`, err.message);
      }
    }, 3000);
  }

  async handleCrashRecovery(reason) {
    if (this.isStopping) return;
    console.log(`${new Date().toISOString()} [recovery.start] Initiating recovery due to: ${reason}`);
    this.state.transition(RecordingStates.RECOVERING, { recovery_reason: reason });

    try {
      if (reason === 'browser' || reason === 'jitsi_reconnect') {
        console.log(`${new Date().toISOString()} [recovery.browser] Relaunching browser and re-joining Jitsi...`);
        await this.initAndJoinBot();
      } else if (reason === 'ffmpeg') {
        console.log(`${new Date().toISOString()} [recovery.ffmpeg] Restarting FFmpeg recording pipeline...`);
        await this.initAndStartFFmpeg();
      }

      this.state.transition(RecordingStates.RECORDING);
      console.log(`${new Date().toISOString()} [recovery.completed] Recovered successfully back to RECORDING.`);
    } catch (err) {
      console.error(`${new Date().toISOString()} [recovery.failed] Recovery failed:`, err);
      this.state.transition(RecordingStates.FAILED, { error: `Recovery failed: ${err.message}` });
      await this.cleanup();
    }
  }

  async stop(stopReason = 'User requested stop') {
    if (this.isStopping) {
      console.log(`${new Date().toISOString()} [worker.stop] Already stopping.`);
      return this.state.getSnapshot();
    }

    this.isStopping = true;
    console.log(`${new Date().toISOString()} [worker.stopping] Stopping recording for meeting: ${this.meetingId} (Reason: ${stopReason})`);
    this.state.transition(RecordingStates.STOPPING, { stop_reason: stopReason });

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    // 1. Stop FFmpeg gracefully to flush current segment
    if (this.ffmpeg) {
      await this.ffmpeg.stop().catch((e) => console.warn(`[ffmpeg.stop] ${e.message}`));
    }

    // 2. Disconnect and close browser
    if (this.bot) {
      await this.bot.close().catch((e) => console.warn(`[bot.close] ${e.message}`));
    }

    // 3. Post-processing: Remux segments into final.mp4
    this.state.transition(RecordingStates.PROCESSING);

    try {
      const segments = this.storage.listSegments(this.meetingId);
      console.log(`${new Date().toISOString()} [worker.processing] Found ${segments.length} segments.`);
      const finalPath = this.storage.getFinalRecordingPath(this.meetingId);

      if (segments.length === 0) {
        throw new Error('No recorded segments found to process.');
      }

      const probeResult = await this.ffmpeg.concatenateSegments(segments, finalPath);

      this.state.transition(RecordingStates.COMPLETED, {
        final_file: finalPath,
        segments: segments.map((s) => path.basename(s)),
        stats: {
          duration_seconds: probeResult.duration,
          file_size_bytes: probeResult.sizeBytes,
          video_streams: probeResult.video ? 1 : 0,
          audio_streams: probeResult.audio ? 1 : 0,
          resolution: probeResult.video ? `${probeResult.video.width}x${probeResult.video.height}` : 'unknown'
        }
      });

      console.log(`${new Date().toISOString()} [worker.completed] Recording fully completed and finalized at: ${finalPath}`);
    } catch (err) {
      console.error(`${new Date().toISOString()} [worker.processing.failed] Processing failed:`, err);
      this.state.transition(RecordingStates.FAILED, { error: err.message });
    }

    await this.cleanup();
    return this.state.getSnapshot();
  }

  async cleanup() {
    try {
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      if (this.bot) await this.bot.close().catch(() => {});
      if (this.ffmpeg) await this.ffmpeg.stop().catch(() => {});
      // Note: we leave Xvfb and PulseAudio running if shared or manage if isolated
    } catch (err) {
      console.warn(`[worker.cleanup] ${err.message}`);
    }
  }

  getHealth() {
    return {
      status: this.state.state.status,
      recording_id: this.recordingId,
      meeting_id: this.meetingId,
      is_recording: Boolean(this.ffmpeg?.isRecording),
      browser_connected: Boolean(this.bot?.isConnected),
      free_disk_mb: this.storage.getFreeDiskSpaceMB(),
      segment_count: this.storage.listSegments(this.meetingId).length,
      recovery_attempts: this.state.state.recovery_attempts || 0
    };
  }
}
