import { execSync, spawn } from 'node:child_process';

export class AudioManager {
  constructor(options = {}) {
    this.sinkName = options.sinkName || process.env.PULSE_SINK_NAME || 'jitsi_virtual_sink';
    this.sinkDescription = options.sinkDescription || 'Jitsi_Virtual_Recording_Sink';
    this.moduleIndex = null;
  }

  isPulseRunning() {
    try {
      execSync('pactl info', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  ensurePulseDaemon() {
    if (!this.isPulseRunning()) {
      console.log(`${new Date().toISOString()} [audio.daemon] Pulse daemon not active. Starting local pulseaudio...`);
      try {
        execSync('pulseaudio -D --exit-idle-time=-1 --disallow-exit --disallow-module-loading=0', { stdio: 'ignore' });
      } catch (err) {
        console.warn(`${new Date().toISOString()} [audio.daemon.warning] Error starting pulseaudio daemon: ${err.message}`);
      }
    }
  }

  getExistingSink() {
    try {
      const output = execSync('pactl list sinks short', { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts[1] === this.sinkName) {
          return parts[0]; // sink index
        }
      }
    } catch {}
    return null;
  }

  getMonitorSource() {
    return `${this.sinkName}.monitor`;
  }

  async setup() {
    this.ensurePulseDaemon();

    const existing = this.getExistingSink();
    if (existing) {
      console.log(`${new Date().toISOString()} [audio.sink] Virtual sink '${this.sinkName}' already exists (index ${existing}).`);
    } else {
      console.log(`${new Date().toISOString()} [audio.sink.creating] Loading module-null-sink for '${this.sinkName}'...`);
      try {
        const modId = execSync(
          `pactl load-module module-null-sink sink_name=${this.sinkName} sink_properties=device.description="${this.sinkDescription}"`,
          { encoding: 'utf8' }
        ).trim();
        this.moduleIndex = modId;
        console.log(`${new Date().toISOString()} [audio.sink.created] Loaded module index ${modId}`);
      } catch (err) {
        throw new Error(`Failed to create PulseAudio null-sink: ${err.message}`);
      }
    }

    // Set default sink
    try {
      execSync(`pactl set-default-sink ${this.sinkName}`);
      console.log(`${new Date().toISOString()} [audio.default_sink] Default sink set to '${this.sinkName}'`);
    } catch (err) {
      console.warn(`${new Date().toISOString()} [audio.warning] Could not set default sink: ${err.message}`);
    }

    // Verify monitor source
    const monitorSource = this.getMonitorSource();
    try {
      const sourcesOutput = execSync('pactl list sources short', { encoding: 'utf8' });
      if (!sourcesOutput.includes(monitorSource)) {
        throw new Error(`Monitor source '${monitorSource}' not found in pactl list sources.`);
      }
      console.log(`${new Date().toISOString()} [audio.monitor.ready] Verified monitor source: ${monitorSource}`);
    } catch (err) {
      throw new Error(`Monitor source verification failed: ${err.message}`);
    }

    return {
      sinkName: this.sinkName,
      monitorSource: monitorSource
    };
  }

  /**
   * Quick test verifying that audio can be captured from the monitor source
   */
  async testAudioCapture(durationSec = 2) {
    const monitorSource = this.getMonitorSource();
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ffmpeg', [
        '-y',
        '-f', 'pulse',
        '-i', monitorSource,
        '-t', String(durationSec),
        '-f', 'null',
        '-'
      ]);

      let stderr = '';
      testProcess.stderr.on('data', (d) => { stderr += d.toString(); });

      testProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`${new Date().toISOString()} [audio.test.success] Test capture from ${monitorSource} succeeded.`);
          resolve(true);
        } else {
          console.warn(`${new Date().toISOString()} [audio.test.warning] Audio capture test returned code ${code}: ${stderr.slice(-200)}`);
          // Return false rather than throw to allow environments without ffmpeg installed locally
          resolve(false);
        }
      });
      testProcess.on('error', (err) => {
        console.warn(`${new Date().toISOString()} [audio.test.error] Could not run ffmpeg test: ${err.message}`);
        resolve(false);
      });
    });
  }

  cleanup() {
    if (this.moduleIndex) {
      try {
        console.log(`${new Date().toISOString()} [audio.cleanup] Unloading module ${this.moduleIndex}...`);
        execSync(`pactl unload-module ${this.moduleIndex}`);
      } catch (err) {
        console.warn(`[audio.cleanup] Failed to unload module: ${err.message}`);
      }
      this.moduleIndex = null;
    }
  }
}
