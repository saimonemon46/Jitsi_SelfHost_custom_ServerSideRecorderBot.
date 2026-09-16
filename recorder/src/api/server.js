import express from 'express';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { RecordingWorker } from '../worker/recorder.js';
import { StorageManager } from '../storage/filesystem.js';
import { RecordingStates } from '../state/state-manager.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.RECORDER_API_KEY || 'local-dev-secret-key-123';

// Active workers map: recording_id -> RecordingWorker
const activeWorkers = new Map();
// Mapping meeting_id -> recording_id for idempotency
const meetingToRecordingMap = new Map();

// Metrics counters (Phase 20)
const metrics = {
  recordings_started: 0,
  recordings_completed: 0,
  recordings_failed: 0,
  recordings_stopped: 0,
  browser_restarts: 0,
  ffmpeg_restarts: 0,
  segments_created: 0
};

// Security middleware (Phase 11 & 17)
function authenticateApiKey(req, res, next) {
  // Allow health and metrics without auth for local monitoring probes
  if (req.path === '/health' || req.path === '/metrics') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const headerKey = req.headers['x-api-key'];

  let providedKey = headerKey;
  if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
  }

  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid API key. Provide X-API-Key header or Bearer token.'
    });
  }

  next();
}

app.use(authenticateApiKey);

// Structured request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} [http] ${req.method} ${req.url} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

/**
 * POST /recordings/start
 * Idempotent starting of recording bot
 */
app.post('/recordings/start', async (req, res) => {
  const { meeting_id, room_url, display_name, jwt, password } = req.body;

  if (!meeting_id || !room_url) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Fields "meeting_id" and "room_url" are required.'
    });
  }

  // Idempotency Check (Phase 16)
  if (meetingToRecordingMap.has(meeting_id)) {
    const existingRecId = meetingToRecordingMap.get(meeting_id);
    const existingWorker = activeWorkers.get(existingRecId);

    if (existingWorker) {
      const stateSnapshot = existingWorker.state.getSnapshot();
      // If it is active, return existing recording
      if ([RecordingStates.PENDING, RecordingStates.STARTING, RecordingStates.JOINING, RecordingStates.RECORDING, RecordingStates.RECOVERING].includes(stateSnapshot.status)) {
        console.log(`${new Date().toISOString()} [idempotency.hit] Returning existing active recording ${existingRecId} for meeting ${meeting_id}`);
        return res.status(200).json({
          message: 'Active recording already exists for this meeting (idempotent response).',
          recording_id: existingRecId,
          meeting_id,
          status: stateSnapshot.status,
          snapshot: stateSnapshot
        });
      }
    }
  }

  const recordingId = `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  metrics.recordings_started++;

  const worker = new RecordingWorker({
    recordingId,
    meetingId: meeting_id,
    roomUrl: room_url,
    displayName: display_name,
    jwt,
    roomPassword: password
  });

  activeWorkers.set(recordingId, worker);
  meetingToRecordingMap.set(meeting_id, recordingId);

  // Monitor worker events for metrics
  worker.on('error', () => { metrics.recordings_failed++; });
  worker.ffmpeg?.on('segment_created', () => { metrics.segments_created++; });

  // Initiate start asynchronously
  worker.start().catch((err) => {
    console.error(`${new Date().toISOString()} [worker.start.error] Async startup failed for ${recordingId}:`, err.message);
    metrics.recordings_failed++;
  });

  return res.status(202).json({
    recording_id: recordingId,
    meeting_id,
    room_url,
    status: RecordingStates.STARTING,
    message: 'Recorder bot is starting and joining the conference.'
  });
});

/**
 * POST /recordings/:id/stop
 */
app.post('/recordings/:id/stop', async (req, res) => {
  const recordingId = req.params.id;
  const worker = activeWorkers.get(recordingId);

  if (!worker) {
    // Check if recording exists in storage
    return res.status(404).json({
      error: 'NotFound',
      message: `No active recording found with ID: ${recordingId}`
    });
  }

  try {
    const finalSnapshot = await worker.stop('User requested stop via API');
    metrics.recordings_stopped++;

    if (finalSnapshot.status === RecordingStates.COMPLETED) {
      metrics.recordings_completed++;
    } else {
      metrics.recordings_failed++;
    }

    // Clean active map
    activeWorkers.delete(recordingId);
    meetingToRecordingMap.delete(worker.meetingId);

    return res.status(200).json({
      recording_id: recordingId,
      status: finalSnapshot.status,
      final_file: finalSnapshot.final_file,
      stats: finalSnapshot.stats,
      message: 'Recording stopped and processed.'
    });
  } catch (err) {
    return res.status(500).json({
      error: 'InternalError',
      message: `Failed to stop recording: ${err.message}`
    });
  }
});

/**
 * GET /recordings/:id
 */
app.get('/recordings/:id', (req, res) => {
  const recordingId = req.params.id;
  const worker = activeWorkers.get(recordingId);

  if (worker) {
    return res.status(200).json(worker.state.getSnapshot());
  }

  // Look up in filesystem storage if not in memory
  const storage = new StorageManager();
  // Find meeting directory matching state
  return res.status(404).json({
    error: 'NotFound',
    message: `Active recording ${recordingId} not found.`
  });
});

/**
 * GET /recordings/:id/status
 */
app.get('/recordings/:id/status', (req, res) => {
  const recordingId = req.params.id;
  const worker = activeWorkers.get(recordingId);

  if (!worker) {
    return res.status(404).json({
      error: 'NotFound',
      message: `Recording ${recordingId} not found.`
    });
  }

  return res.status(200).json({
    recording_id: recordingId,
    meeting_id: worker.meetingId,
    status: worker.state.state.status,
    updated_at: worker.state.state.updated_at,
    health: worker.getHealth()
  });
});

/**
 * GET /health (Phase 13 & 20)
 */
app.get('/health', (req, res) => {
  const storage = new StorageManager();
  const freeMB = storage.getFreeDiskSpaceMB();

  const activeRecordings = [];
  for (const [id, worker] of activeWorkers.entries()) {
    activeRecordings.push(worker.getHealth());
  }

  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    active_recordings_count: activeWorkers.size,
    active_recordings: activeRecordings,
    storage: {
      free_disk_mb: freeMB,
      is_disk_ok: freeMB > 1024
    }
  });
});

/**
 * GET /metrics (Phase 20)
 */
app.get('/metrics', (req, res) => {
  res.status(200).json({
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    counters: metrics,
    active_recordings: activeWorkers.size
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${new Date().toISOString()} [api.started] Recorder API listening on http://0.0.0.0:${PORT}`);
  console.log(`${new Date().toISOString()} [api.auth] Authentication enabled. Use X-API-Key: ${API_KEY}`);
});
