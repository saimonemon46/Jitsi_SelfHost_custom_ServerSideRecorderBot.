import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export class StorageManager {
  constructor(baseDir = process.env.RECORDINGS_DIR || '/recordings') {
    this.baseDir = path.resolve(baseDir);
    this.ensureDirectory(this.baseDir);
  }

  ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
    }
  }

  getMeetingDir(meetingId) {
    // Sanitize meeting ID to prevent path traversal
    const safeMeetingId = meetingId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const meetingDir = path.join(this.baseDir, safeMeetingId);
    this.ensureDirectory(meetingDir);
    return meetingDir;
  }

  getSegmentPattern(meetingId) {
    const meetingDir = this.getMeetingDir(meetingId);
    return path.join(meetingDir, 'segment-%04d.mp4');
  }

  getFinalRecordingPath(meetingId) {
    const meetingDir = this.getMeetingDir(meetingId);
    return path.join(meetingDir, 'final.mp4');
  }

  getStateFilePath(meetingId) {
    const meetingDir = this.getMeetingDir(meetingId);
    return path.join(meetingDir, 'state.json');
  }

  getLogFilePath(meetingId) {
    const meetingDir = this.getMeetingDir(meetingId);
    return path.join(meetingDir, 'recorder.log');
  }

  listSegments(meetingId) {
    const meetingDir = this.getMeetingDir(meetingId);
    if (!fs.existsSync(meetingDir)) return [];
    return fs.readdirSync(meetingDir)
      .filter(file => /^segment-\d{4}\.mp4$/.test(file))
      .sort()
      .map(file => path.join(meetingDir, file));
  }

  getFreeDiskSpaceMB() {
    try {
      const output = execSync(`df -k "${this.baseDir}" | tail -1`).toString().trim();
      const parts = output.split(/\s+/);
      const availKb = parseInt(parts[3], 10);
      return Math.round(availKb / 1024);
    } catch {
      return -1;
    }
  }

  checkDiskSpace(minRequiredMB = 1024) {
    const freeMB = this.getFreeDiskSpaceMB();
    if (freeMB > 0 && freeMB < minRequiredMB) {
      throw new Error(`Insufficient disk space: ${freeMB}MB free, required at least ${minRequiredMB}MB.`);
    }
    return freeMB;
  }
}
