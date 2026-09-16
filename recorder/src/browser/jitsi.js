import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';

export class JitsiBot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.roomUrl = options.roomUrl;
    this.displayName = options.displayName || process.env.BOT_DISPLAY_NAME || 'Course Recorder';
    this.display = options.display || process.env.DISPLAY || ':99';
    this.width = parseInt(options.width || process.env.VIDEO_WIDTH || '1920', 10);
    this.height = parseInt(options.height || process.env.VIDEO_HEIGHT || '1080', 10);
    this.jwt = options.jwt || process.env.JITSI_JWT || null;
    this.roomPassword = options.roomPassword || null;

    this.browser = null;
    this.context = null;
    this.page = null;
    this.isConnected = false;
    this.statusPollInterval = null;
  }

  buildTargetUrl() {
    let url = new URL(this.roomUrl);

    // If JWT is configured, add it to query string
    if (this.jwt) {
      url.searchParams.set('jwt', this.jwt);
    }

    // Hash parameters configure Jitsi directly without relying solely on fragile DOM selectors
    const hashParams = [
      'config.prejoinConfig.enabled=false',
      `userInfo.displayName="${encodeURIComponent(this.displayName)}"`,
      'config.startWithAudioMuted=true',
      'config.startWithVideoMuted=true',
      'config.disableDeepLinking=true',
      'config.disableThirdPartyRequests=true',
      'config.analytics.disabled=true',
      'config.p2p.enabled=false', // Ensure traffic goes through JVB so recordings stay stable
      'config.hideConferenceSubject=true',
      'config.filmstrip.disableStageFilmstrip=false',
      'interfaceConfig.SHOW_JITSI_WATERMARK=false',
      'interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false',
      'interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true'
    ];

    // Combine existing hash if present
    const existingHash = url.hash.replace(/^#/, '');
    const newHash = existingHash ? `${existingHash}&${hashParams.join('&')}` : hashParams.join('&');
    url.hash = newHash;

    return url.toString();
  }

  async launch() {
    console.log(`${new Date().toISOString()} [browser.launching] Launching Chromium on DISPLAY=${this.display}...`);

    this.browser = await chromium.launch({
      headless: false, // Must be non-headless to render to Xvfb virtual display
      executablePath: process.env.CHROME_BIN || undefined,
      env: {
        ...process.env,
        DISPLAY: this.display,
        PULSE_SINK: process.env.PULSE_SINK_NAME || 'jitsi_virtual_sink'
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--ignore-certificate-errors',
        '--allow-running-insecure-content',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--window-size=${this.width},${this.height}`,
        `--window-position=0,0`,
        '--kiosk', // Fullscreen without browser chrome or bookmarks bar
        '--disable-notifications',
        '--disable-infobars',
        '--no-first-run'
      ]
    });

    this.context = await this.browser.newContext({
      viewport: { width: this.width, height: this.height },
      ignoreHTTPSErrors: true,
      permissions: ['camera', 'microphone']
    });

    this.page = await this.context.newPage();

    this.page.on('console', (msg) => {
      const text = msg.text();
      // Filter out harmless WebRTC logs to keep console clean
      if (text.includes('CONFERENCE JOINED') || text.includes('Conference joined') || text.includes('Error')) {
        console.log(`${new Date().toISOString()} [browser.console] ${text}`);
      }
    });

    this.page.on('crash', () => {
      console.error(`${new Date().toISOString()} [browser.crashed] Chromium page crashed!`);
      this.emit('crashed', new Error('Browser page crashed'));
    });

    this.browser.on('disconnected', () => {
      console.warn(`${new Date().toISOString()} [browser.disconnected] Browser process disconnected.`);
      this.emit('disconnected');
    });

    console.log(`${new Date().toISOString()} [browser.launched] Chromium ready.`);
  }

  async join() {
    const targetUrl = this.buildTargetUrl();
    console.log(`${new Date().toISOString()} [jitsi.navigating] Navigating to: ${targetUrl}`);

    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle any prejoin screen or prompt if prejoin bypass was ignored
    await this.handlePrejoinOrPrompts();

    // Wait for conference to be joined
    const joined = await this.waitForConferenceJoined(30000);
    if (!joined) {
      throw new Error(`Timeout waiting for Jitsi conference to be joined at ${this.roomUrl}`);
    }

    this.isConnected = true;
    console.log(`${new Date().toISOString()} [jitsi.joined] Recorder bot successfully joined conference as '${this.displayName}'`);

    // Ensure tile view layout so all participants are framed nicely
    await this.setTileViewLayout();

    // Start polling conference connection status
    this.startStatusMonitor();

    return true;
  }

  async handlePrejoinOrPrompts() {
    try {
      // 1. Check for display name input on prejoin screen
      const nameInput = this.page.locator('input[data-testid="prejoin.nameInput"], input[placeholder*="name" i]').first();
      if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`${new Date().toISOString()} [jitsi.prejoin] Filling display name...`);
        await nameInput.fill(this.displayName);
      }

      // 2. Check for password input if room is password-protected
      if (this.roomPassword) {
        const passInput = this.page.locator('input[data-testid="password-input"], input[type="password"]').first();
        if (await passInput.isVisible({ timeout: 1500 }).catch(() => false)) {
          console.log(`${new Date().toISOString()} [jitsi.password] Entering room password...`);
          await passInput.fill(this.roomPassword);
          await this.page.keyboard.press('Enter');
        }
      }

      // 3. Click Join meeting button if prejoin modal is visible
      const joinBtn = this.page.locator(
        'button[data-testid="prejoin.joinMeeting"], button:has-text("Join meeting"), [aria-label*="Join meeting" i]'
      ).first();
      if (await joinBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`${new Date().toISOString()} [jitsi.prejoin] Clicking 'Join meeting' button...`);
        await joinBtn.click();
      }

      // 4. Dismiss any cookie or "download the app" promos
      const promoClose = this.page.locator('.close-button, [aria-label="Close"]').first();
      if (await promoClose.isVisible({ timeout: 1000 }).catch(() => false)) {
        await promoClose.click().catch(() => {});
      }
    } catch (err) {
      console.warn(`${new Date().toISOString()} [jitsi.prejoin.warning] Notice handling prejoin prompts:`, err.message);
    }
  }

  async waitForConferenceJoined(timeoutMs = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const isJoined = await this.page.evaluate(() => {
          // Check Jitsi APP global API
          if (window.APP?.conference?.isJoined?.()) {
            return true;
          }
          // Alternative DOM indicators: presence of filmstrip or large video canvas
          const inCallIndicator = document.querySelector('#largeVideo, .videocontainer, #filmstripRemoteVideos');
          if (inCallIndicator && !document.querySelector('[data-testid="prejoin.joinMeeting"]')) {
            return true;
          }
          return false;
        });

        if (isJoined) {
          return true;
        }
      } catch {}

      await new Promise((r) => setTimeout(r, 500));
    }

    return false;
  }

  async setTileViewLayout() {
    try {
      await this.page.evaluate(() => {
        // Trigger tile view mode if available
        if (window.APP?.UI?.isTileViewEnabled && !window.APP.UI.isTileViewEnabled()) {
          window.APP.UI.toggleTileView();
        }
      });
    } catch (err) {
      // Non-critical
    }
  }

  startStatusMonitor() {
    if (this.statusPollInterval) clearInterval(this.statusPollInterval);

    this.statusPollInterval = setInterval(async () => {
      if (!this.page || this.page.isClosed()) return;

      try {
        const status = await this.page.evaluate(() => {
          const joined = Boolean(window.APP?.conference?.isJoined?.());
          const participants = window.APP?.conference?.getParticipants?.() || [];
          return {
            joined,
            participantCount: participants.length
          };
        });

        if (!status.joined && this.isConnected) {
          console.warn(`${new Date().toISOString()} [jitsi.disconnected] Bot detected conference disconnection!`);
          this.isConnected = false;
          this.emit('disconnected');
        } else if (status.joined && !this.isConnected) {
          this.isConnected = true;
          console.log(`${new Date().toISOString()} [jitsi.reconnected] Bot re-established conference connection.`);
          this.emit('reconnected');
        }
      } catch (err) {
        // If evaluate fails because page is closed or unresponsive
        if (this.isConnected) {
          console.warn(`${new Date().toISOString()} [jitsi.poll.error] Error querying conference status: ${err.message}`);
        }
      }
    }, 2000);
  }

  async getParticipantCount() {
    if (!this.page || this.page.isClosed()) return 0;
    try {
      return await this.page.evaluate(() => {
        const p = window.APP?.conference?.getParticipants?.();
        return Array.isArray(p) ? p.length : 0;
      });
    } catch {
      return 0;
    }
  }

  async close() {
    console.log(`${new Date().toISOString()} [browser.closing] Closing Jitsi bot browser...`);
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }

    try {
      if (this.page && !this.page.isClosed()) {
        // Hangup cleanly if possible
        await this.page.evaluate(() => {
          window.APP?.conference?.hangup?.();
        }).catch(() => {});
        await this.page.close().catch(() => {});
      }
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    } catch (err) {
      console.warn(`[browser.close] Notice while closing: ${err.message}`);
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
      this.isConnected = false;
      console.log(`${new Date().toISOString()} [browser.closed] Browser closed.`);
    }
  }
}
