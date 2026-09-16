import { chromium } from 'playwright';

const API_BASE = process.env.RECORDER_API_URL || 'http://localhost:3000';
const API_KEY = process.env.RECORDER_API_KEY || 'local-dev-secret-key-123';
const MEETING_ID = `powerloss-class-${Date.now()}`;
const ROOM_URL = `https://meet.localhost/${MEETING_ID}`;

const log = (msg) => console.log(`${new Date().toISOString()} [phase-14-test] ${msg}`);

async function createParticipant(browser, name) {
  log(`Connecting participant: ${name}...`);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['camera', 'microphone']
  });
  const page = await context.newPage();

  const hashParams = [
    'config.prejoinConfig.enabled=false',
    `userInfo.displayName="${encodeURIComponent(name)}"`,
    'config.disableDeepLinking=true',
    'config.p2p.enabled=false'
  ].join('&');

  await page.goto(`${ROOM_URL}#${hashParams}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Handle any prejoin prompt if not automatically bypassed
  try {
    const nameInput = page.locator('input[data-testid="prejoin.nameInput"]').first();
    if (await nameInput.isVisible({ timeout: 1500 }).catch(() => false)) {
      await nameInput.fill(name);
    }
    const joinBtn = page.locator('button[data-testid="prejoin.joinMeeting"], button:has-text("Join meeting")').first();
    if (await joinBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await joinBtn.click();
    }
  } catch {}

  // Wait for conference joined
  await page.waitForFunction(() => Boolean(window.APP?.conference?.isJoined?.()), { timeout: 25000 });
  log(`✔ ${name} joined room ${MEETING_ID}`);
  return { context, page };
}

async function run() {
  log('================================================================');
  log('   STARTING PHASE 14: HOST ABRUPT POWER-LOSS & REJOIN TEST      ');
  log('================================================================');
  log(`Meeting ID: ${MEETING_ID}`);
  log(`Room URL:   ${ROOM_URL}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  try {
    // 1. Connect Teacher (Host)
    log('\n--- Step 1: Connect Teacher (Host) ---');
    let teacher = await createParticipant(browser, 'Teacher (Host)');

    // 2. Connect Two Student Browsers
    log('\n--- Step 2: Connect Student 1 & Student 2 ---');
    const student1 = await createParticipant(browser, 'Student Alice');
    const student2 = await createParticipant(browser, 'Student Bob');

    // 3. Start Recorder Bot via API
    log('\n--- Step 3: Trigger Recorder Bot via POST /recordings/start ---');
    const startRes = await fetch(`${API_BASE}/recordings/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        meeting_id: MEETING_ID,
        room_url: ROOM_URL
      })
    });

    const startData = await startRes.json();
    log(`Recorder API response: ${JSON.stringify(startData)}`);
    const recordingId = startData.recording_id;

    if (!recordingId) {
      throw new Error('Failed to start recording bot');
    }

    // 4. Confirm Recording is active
    log('\n--- Step 4: Confirming Recording Status ---');
    let active = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const stRes = await fetch(`${API_BASE}/recordings/${recordingId}/status`, {
        headers: { 'X-API-Key': API_KEY }
      });
      const st = await stRes.json();
      log(`[Check ${i + 1}] Status: ${st.status} (is_recording: ${st.health?.is_recording})`);
      if (st.status === 'RECORDING' && st.health?.is_recording) {
        active = true;
        break;
      }
    }

    if (!active) {
      throw new Error('Recorder bot failed to enter RECORDING state.');
    }

    log('✔ Conference is actively recording with Teacher, Student 1, Student 2, and Recorder Bot.');

    // 5. Normal class period before host disconnect (10 seconds)
    log('\n--- Step 5: Recording normal class before disconnect (10s)... ---');
    await new Promise((r) => setTimeout(r, 10000));

    // 6. Simulate Host Abrupt Disconnect (Power Loss / Kill Browser)
    log('\n--- Step 6: SIMULATING TEACHER ABRUPT POWER LOSS / CRASH ---');
    log('Killing teacher browser context immediately (no clean hangup)...');
    await teacher.page.close().catch(() => {});
    await teacher.context.close().catch(() => {});
    teacher = null;
    log('✔ Teacher context terminated. Host is now absent.');

    // 7. Verify conference remains alive for students and recorder
    log('\n--- Step 7: Verifying room and recording remain alive during host absence ---');
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const s1Joined = await student1.page.evaluate(() => window.APP?.conference?.isJoined?.());
      const s2Joined = await student2.page.evaluate(() => window.APP?.conference?.isJoined?.());

      const recStatus = await fetch(`${API_BASE}/recordings/${recordingId}/status`, {
        headers: { 'X-API-Key': API_KEY }
      }).then((r) => r.json());

      log(`[Absence +${i * 4}s] Student1: ${s1Joined}, Student2: ${s2Joined}, Recorder: ${recStatus.status}, IsRecording: ${recStatus.health?.is_recording}`);

      if (!s1Joined || !s2Joined || recStatus.status !== 'RECORDING') {
        throw new Error(`Conference collapsed during host absence! s1: ${s1Joined}, s2: ${s2Joined}, rec: ${recStatus.status}`);
      }
    }
    log('✔ Verified: Jitsi conference and recording continue uninterrupted without host!');

    // 8. Reconnect Teacher to the SAME Jitsi room
    log('\n--- Step 8: Teacher reconnects / rejoins the SAME Jitsi room ---');
    teacher = await createParticipant(browser, 'Teacher (Rejoined)');
    log('✔ Teacher successfully rejoined the same room!');

    // 9. Post-rejoin recording period (10 seconds)
    log('\n--- Step 9: Recording conference post-rejoin (10s)... ---');
    await new Promise((r) => setTimeout(r, 10000));

    // 10. Stop Recording
    log('\n--- Step 10: Stopping recording via API ---');
    const stopRes = await fetch(`${API_BASE}/recordings/${recordingId}/stop`, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY }
    });
    const stopData = await stopRes.json();
    log(`Stop response: ${JSON.stringify(stopData, null, 2)}`);

    // Clean participants
    await student1.context.close().catch(() => {});
    await student2.context.close().catch(() => {});
    if (teacher) await teacher.context.close().catch(() => {});

    log('\n================================================================');
    log('     PHASE 14 POWER-LOSS & REJOIN TEST COMPLETED SUCCESSFULLY!   ');
    log('================================================================');
    log(`Final Recording: ${stopData.final_file}`);
    log(`Duration:        ${stopData.stats?.duration_seconds}s`);
    log(`File Size:       ${(stopData.stats?.file_size_bytes / 1024 / 1024).toFixed(2)} MB`);
    log(`Video Streams:   ${stopData.stats?.video_streams}`);
    log(`Audio Streams:   ${stopData.stats?.audio_streams}`);
    log('================================================================');
  } finally {
    await browser.close().catch(() => {});
  }
}

run().catch((err) => {
  console.error('\n[FATAL] Phase 14 Test Failed:', err);
  process.exit(1);
});
