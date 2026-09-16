import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateManager, RecordingStates } from '../src/state/state-manager.js';
import { StorageManager } from '../src/storage/filesystem.js';

test('StateManager - Valid transitions and state persistence', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
  const stateFile = path.join(tmpDir, 'state.json');

  try {
    const sm = new StateManager(stateFile, {
      recording_id: 'rec_123',
      meeting_id: 'test-room',
      room_url: 'https://meet.localhost/test-room'
    });

    assert.equal(sm.state.status, RecordingStates.PENDING);
    assert.equal(fs.existsSync(stateFile), true);

    // Transition PENDING -> STARTING
    sm.transition(RecordingStates.STARTING);
    assert.equal(sm.state.status, RecordingStates.STARTING);

    // Transition STARTING -> JOINING
    sm.transition(RecordingStates.JOINING);
    assert.equal(sm.state.status, RecordingStates.JOINING);

    // Transition JOINING -> RECORDING
    sm.transition(RecordingStates.RECORDING);
    assert.equal(sm.state.status, RecordingStates.RECORDING);
    assert.ok(sm.state.started_at);

    // Transition RECORDING -> STOPPING
    sm.transition(RecordingStates.STOPPING);
    assert.equal(sm.state.status, RecordingStates.STOPPING);
    assert.ok(sm.state.stopped_at);

    // Transition STOPPING -> PROCESSING
    sm.transition(RecordingStates.PROCESSING);
    assert.equal(sm.state.status, RecordingStates.PROCESSING);

    // Transition PROCESSING -> COMPLETED
    sm.transition(RecordingStates.COMPLETED, { final_file: '/recordings/test-room/final.mp4' });
    assert.equal(sm.state.status, RecordingStates.COMPLETED);
    assert.equal(sm.state.final_file, '/recordings/test-room/final.mp4');
    assert.ok(sm.state.completed_at);

    // Check persisted state file directly
    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persisted.status, RecordingStates.COMPLETED);
    assert.equal(persisted.final_file, '/recordings/test-room/final.mp4');
    assert.ok(persisted.started_at);
    assert.ok(persisted.stopped_at);
    assert.ok(persisted.completed_at);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StateManager - Snapshot returns deep copy of state', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
  const stateFile = path.join(tmpDir, 'state.json');

  try {
    const sm = new StateManager(stateFile, {
      recording_id: 'rec_123',
      meeting_id: 'test-room'
    });

    const snapshot = sm.getSnapshot();
    assert.equal(snapshot.recording_id, 'rec_123');
    assert.equal(snapshot.status, RecordingStates.PENDING);
    // Modifying snapshot should not affect internal state
    snapshot.status = 'MUTATED';
    assert.equal(sm.state.status, RecordingStates.PENDING);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StorageManager - Directory isolation and path traversal prevention', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));

  try {
    const storage = new StorageManager(tmpDir);

    // Normal meeting directory
    const meetingDir = storage.getMeetingDir('demo-class');
    assert.equal(meetingDir, path.join(tmpDir, 'demo-class'));
    assert.equal(fs.existsSync(meetingDir), true);

    // Path traversal sanitized
    const maliciousMeetingDir = storage.getMeetingDir('../../../etc/passwd');
    assert.ok(!maliciousMeetingDir.includes('../'));
    assert.ok(maliciousMeetingDir.startsWith(tmpDir));

    // File paths
    assert.equal(storage.getFinalRecordingPath('demo-class'), path.join(tmpDir, 'demo-class', 'final.mp4'));
    assert.equal(storage.getStateFilePath('demo-class'), path.join(tmpDir, 'demo-class', 'state.json'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
