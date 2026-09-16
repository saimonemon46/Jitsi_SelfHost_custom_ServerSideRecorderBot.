import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

export class DisplayManager {
  constructor(options = {}) {
    this.display = options.display || process.env.DISPLAY || ':99';
    this.width = parseInt(options.width || process.env.VIDEO_WIDTH || '1920', 10);
    this.height = parseInt(options.height || process.env.VIDEO_HEIGHT || '1080', 10);
    this.depth = 24;
    this.xvfbProcess = null;
    this.isManaged = false;
  }

  isDisplayRunning() {
    try {
      const displayNumber = this.display.replace(':', '').split('.')[0];
      const xLockFile = `/tmp/.X${displayNumber}-lock`;
      const xSocket = `/tmp/.X11-unix/X${displayNumber}`;
      if (fs.existsSync(xLockFile) || fs.existsSync(xSocket)) {
        return true;
      }
      // Also test with xdpyinfo if available
      try {
        execSync(`xdpyinfo -display ${this.display}`, { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  async start() {
    if (this.isDisplayRunning()) {
      console.log(`${new Date().toISOString()} [display.ready] Display ${this.display} is already active.`);
      return { display: this.display, width: this.width, height: this.height };
    }

    console.log(`${new Date().toISOString()} [display.starting] Launching Xvfb on ${this.display} (${this.width}x${this.height}x${this.depth})...`);
    
    // Clean stale lock if needed
    const displayNumber = this.display.replace(':', '').split('.')[0];
    try {
      fs.rmSync(`/tmp/.X${displayNumber}-lock`, { force: true });
      fs.rmSync(`/tmp/.X11-unix/X${displayNumber}`, { force: true });
    } catch {}

    this.xvfbProcess = spawn('Xvfb', [
      this.display,
      '-screen', '0', `${this.width}x${this.height}x${this.depth}`,
      '-ac',
      '-nolisten', 'tcp',
      '+extension', 'GLX',
      '+render',
      '-noreset'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.isManaged = true;

    this.xvfbProcess.stderr.on('data', (chunk) => {
      const msg = chunk.toString().trim();
      if (msg && !msg.includes('glXChooseVisual')) {
        console.warn(`${new Date().toISOString()} [xvfb.stderr] ${msg}`);
      }
    });

    this.xvfbProcess.on('exit', (code, signal) => {
      console.log(`${new Date().toISOString()} [xvfb.exited] Xvfb process exited with code ${code}, signal ${signal}`);
      this.xvfbProcess = null;
    });

    // Wait up to 5 seconds for display socket to become ready
    const startTime = Date.now();
    while (Date.now() - startTime < 5000) {
      if (this.isDisplayRunning()) {
        console.log(`${new Date().toISOString()} [display.started] Virtual display ${this.display} is ready.`);
        return { display: this.display, width: this.width, height: this.height };
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`Failed to initialize Xvfb virtual display on ${this.display} within timeout.`);
  }

  stop() {
    if (this.isManaged && this.xvfbProcess) {
      console.log(`${new Date().toISOString()} [display.stopping] Terminating managed Xvfb process...`);
      try {
        this.xvfbProcess.kill('SIGTERM');
      } catch (err) {
        console.warn(`[display] Error terminating Xvfb:`, err.message);
      }
      this.xvfbProcess = null;
    }
  }
}
