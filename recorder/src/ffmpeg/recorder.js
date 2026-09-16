import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class FFmpegRecorder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.display = options.display || process.env.DISPLAY || ':99';
    this.audioSource = options.audioSource || process.env.PULSE_SOURCE || 'jitsi_virtual_sink.monitor';
    this.outputPattern = options.outputPattern; // e.g. /path/to/recordings/id/segment-%04d.mp4
    this.meetingDir = options.meetingDir;
    this.finalPath = options.finalPath;

    // Configurable parameters (Phase 8)
    this.videoWidth = parseInt(options.videoWidth || process.env.VIDEO_WIDTH || '1920', 10);
    this.videoHeight = parseInt(options.videoHeight || process.env.VIDEO_HEIGHT || '1080', 10);
    this.videoFps = parseInt(options.videoFps || process.env.VIDEO_FPS || '30', 10);
    this.videoBitrate = options.videoBitrate || process.env.VIDEO_BITRATE || '4M';
    this.audioBitrate = options.audioBitrate || process.env.AUDIO_BITRATE || '128k';
    this.segmentDurationSec = parseInt(options.segmentDurationSec || process.env.SEGMENT_DURATION_SEC || '60', 10);

    this.process = null;
    this.isRecording = false;
    this.stats = {
      startTime: null,
      stopTime: null,
      lastFileSize: 0,
      lastSizeCheckTime: null
    };
  }

  buildFFmpegArgs() {
    const keyint = this.videoFps * 2; // Keyframe every 2 seconds

    return [
      '-y',
      '-hide_banner',
      '-loglevel', 'info',
      // Video input (X11 grab)
      '-thread_queue_size', '1024',
      '-f', 'x11grab',
      '-draw_mouse', '0',
      '-video_size', `${this.videoWidth}x${this.videoHeight}`,
      '-framerate', String(this.videoFps),
      '-i', `${this.display}.0`,

      // Audio input (PulseAudio monitor)
      '-thread_queue_size', '1024',
      '-f', 'pulse',
      '-i', this.audioSource,

      // Video encoding
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', this.videoBitrate,
      '-maxrate', this.videoBitrate,
      '-bufsize', `${parseInt(this.videoBitrate, 10) * 2}M`,
      '-pix_fmt', 'yuv420p',
      '-g', String(keyint),
      '-keyint_min', String(keyint),
      '-sc_threshold', '0',

      // Audio encoding & sync
      '-c:a', 'aac',
      '-b:a', this.audioBitrate,
      '-ar', '48000',
      '-af', 'aresample=async=1',

      // Segmented output
      '-f', 'segment',
      '-segment_time', String(this.segmentDurationSec),
      '-segment_format', 'mp4',
      '-reset_timestamps', '1',
      '-segment_list_type', 'flat',
      this.outputPattern
    ];
  }

  async start() {
    if (this.isRecording) {
      console.warn(`${new Date().toISOString()} [ffmpeg.already_running] FFmpeg is already recording.`);
      return;
    }

    const args = this.buildFFmpegArgs();
    console.log(`${new Date().toISOString()} [ffmpeg.starting] Starting FFmpeg process with command:`);
    console.log(`ffmpeg ${args.join(' ')}`);

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.isRecording = true;
    this.stats.startTime = Date.now();
    this.stats.lastSizeCheckTime = Date.now();

    this.process.stdout.on('data', (d) => {
      // stdout generally empty with segment muxer
    });

    this.process.stderr.on('data', (chunk) => {
      const msg = chunk.toString();
      if (msg.includes('Opening') && msg.includes('.mp4')) {
        console.log(`${new Date().toISOString()} [ffmpeg.segment.opening] ${msg.trim()}`);
        this.emit('segment_created', msg.trim());
      } else if (msg.includes('frame=') && msg.includes('fps=')) {
        // Heartbeat progress from ffmpeg
        this.emit('progress', msg.trim());
      } else if (msg.includes('Error') || msg.includes('fatal')) {
        console.error(`${new Date().toISOString()} [ffmpeg.error] ${msg.trim()}`);
      }
    });

    this.process.on('close', (code, signal) => {
      console.log(`${new Date().toISOString()} [ffmpeg.exited] FFmpeg closed with code ${code}, signal ${signal}`);
      this.isRecording = false;
      this.stats.stopTime = Date.now();
      this.emit('stopped', { code, signal });
    });

    this.process.on('error', (err) => {
      console.error(`${new Date().toISOString()} [ffmpeg.process.error] FFmpeg spawn error:`, err);
      this.isRecording = false;
      this.emit('error', err);
    });

    // Give ffmpeg 1 second to catch initial startup errors
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`${new Date().toISOString()} [ffmpeg.started] FFmpeg recording pipeline active.`);
        resolve();
      }, 1500);

      this.process.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      this.process.once('close', (code) => {
        clearTimeout(timeout);
        reject(new Error(`FFmpeg exited immediately with code ${code}`));
      });
    });
  }

  async stop(timeoutMs = 10000) {
    if (!this.isRecording || !this.process) {
      console.log(`${new Date().toISOString()} [ffmpeg.stop] No active FFmpeg recording to stop.`);
      return;
    }

    console.log(`${new Date().toISOString()} [ffmpeg.stopping] Sending SIGINT to FFmpeg for graceful finalization...`);
    
    return new Promise((resolve) => {
      const forceKillTimer = setTimeout(() => {
        if (this.process) {
          console.warn(`${new Date().toISOString()} [ffmpeg.force_kill] SIGINT timed out. Sending SIGKILL...`);
          try { this.process.kill('SIGKILL'); } catch {}
        }
        resolve();
      }, timeoutMs);

      this.process.once('close', () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        this.isRecording = false;
        console.log(`${new Date().toISOString()} [ffmpeg.stopped] FFmpeg gracefully terminated.`);
        resolve();
      });

      try {
        // Send 'q' to stdin or SIGINT
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.write('q\n');
        }
        this.process.kill('SIGINT');
      } catch (err) {
        console.warn(`[ffmpeg.stop] Error signaling process: ${err.message}`);
      }
    });
  }

  /**
   * Validate segment file using ffprobe
   */
  static probeFile(filePath) {
    try {
      const output = execSync(
        `ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,duration -show_entries format=duration,size -of json "${filePath}"`,
        { encoding: 'utf8' }
      );
      const data = JSON.parse(output);
      const streams = data.streams || [];
      const format = data.format || {};

      const videoStream = streams.find((s) => s.codec_type === 'video');
      const audioStream = streams.find((s) => s.codec_type === 'audio');

      return {
        valid: Boolean(videoStream && audioStream && (parseFloat(format.duration) > 0 || parseFloat(videoStream.duration) > 0)),
        duration: parseFloat(format.duration || videoStream?.duration || 0),
        sizeBytes: parseInt(format.size || 0, 10),
        video: videoStream ? { codec: videoStream.codec_name, width: videoStream.width, height: videoStream.height } : null,
        audio: audioStream ? { codec: audioStream.codec_name } : null
      };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Concatenate segments without re-encoding
   */
  async concatenateSegments(segments, finalOutputPath) {
    if (!segments || segments.length === 0) {
      throw new Error('No segments available to concatenate.');
    }

    console.log(`${new Date().toISOString()} [ffmpeg.concat.start] Validating and concatenating ${segments.length} segments...`);

    // 1. Validate each segment
    const validSegments = [];
    for (const seg of segments) {
      const probe = FFmpegRecorder.probeFile(seg);
      if (probe.valid && probe.sizeBytes > 1024) {
        validSegments.push(seg);
        console.log(`  ✔ Valid segment: ${path.basename(seg)} (${probe.duration.toFixed(1)}s, ${(probe.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        console.warn(`  ✘ Skipping corrupt or empty segment: ${path.basename(seg)}`);
      }
    }

    if (validSegments.length === 0) {
      throw new Error('All recorded segments failed validation or are empty.');
    }

    // If only one segment, simply copy or rename
    if (validSegments.length === 1) {
      console.log(`${new Date().toISOString()} [ffmpeg.concat.single] Single valid segment found. Copying directly to ${finalOutputPath}`);
      fs.copyFileSync(validSegments[0], finalOutputPath);
      return FFmpegRecorder.probeFile(finalOutputPath);
    }

    // Generate concat list file
    const concatListPath = path.join(this.meetingDir, 'concat_list.txt');
    const fileContent = validSegments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatListPath, fileContent, 'utf8');

    console.log(`${new Date().toISOString()} [ffmpeg.concat.remux] Remuxing via concat demuxer...`);
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy -movflags +faststart "${finalOutputPath}"`, {
      stdio: 'inherit'
    });

    try { fs.unlinkSync(concatListPath); } catch {}

    const finalProbe = FFmpegRecorder.probeFile(finalOutputPath);
    console.log(`${new Date().toISOString()} [ffmpeg.concat.completed] Final file produced: ${finalOutputPath}`);
    console.log(`  Duration: ${finalProbe.duration}s, Size: ${(finalProbe.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
    return finalProbe;
  }
}
