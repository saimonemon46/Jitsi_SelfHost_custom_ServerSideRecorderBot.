import fs from 'node:fs';
import { EventEmitter } from 'node:events';

export const RecordingStates = {
  PENDING: 'PENDING',
  STARTING: 'STARTING',
  JOINING: 'JOINING',
  RECORDING: 'RECORDING',
  RECOVERING: 'RECOVERING',
  STOPPING: 'STOPPING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

export class StateManager extends EventEmitter {
  constructor(stateFilePath, initialData = {}) {
    super();
    this.stateFilePath = stateFilePath;
    this.state = {
      recording_id: initialData.recording_id || null,
      meeting_id: initialData.meeting_id || null,
      room_url: initialData.room_url || null,
      status: RecordingStates.PENDING,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      stopped_at: null,
      completed_at: null,
      error: null,
      recovery_attempts: 0,
      segments: [],
      final_file: null,
      stats: {
        duration_seconds: 0,
        file_size_bytes: 0,
        audio_streams: 0,
        video_streams: 0
      },
      ...initialData
    };
    this.persist();
  }

  transition(newState, metadata = {}) {
    const validTransitions = {
      [RecordingStates.PENDING]: [RecordingStates.STARTING, RecordingStates.CANCELLED, RecordingStates.FAILED],
      [RecordingStates.STARTING]: [RecordingStates.JOINING, RecordingStates.FAILED, RecordingStates.CANCELLED],
      [RecordingStates.JOINING]: [RecordingStates.RECORDING, RecordingStates.RECOVERING, RecordingStates.FAILED, RecordingStates.STOPPING],
      [RecordingStates.RECORDING]: [RecordingStates.STOPPING, RecordingStates.RECOVERING, RecordingStates.FAILED],
      [RecordingStates.RECOVERING]: [RecordingStates.JOINING, RecordingStates.RECORDING, RecordingStates.FAILED, RecordingStates.STOPPING],
      [RecordingStates.STOPPING]: [RecordingStates.PROCESSING, RecordingStates.FAILED],
      [RecordingStates.PROCESSING]: [RecordingStates.COMPLETED, RecordingStates.FAILED],
      [RecordingStates.COMPLETED]: [],
      [RecordingStates.FAILED]: [],
      [RecordingStates.CANCELLED]: []
    };

    const allowed = validTransitions[this.state.status] || [];
    if (!allowed.includes(newState)) {
      console.warn(`[StateManager] Warning: Invalid transition requested from ${this.state.status} to ${newState}`);
    }

    const previousState = this.state.status;
    this.state.status = newState;
    this.state.updated_at = new Date().toISOString();

    if (newState === RecordingStates.RECORDING && !this.state.started_at) {
      this.state.started_at = this.state.updated_at;
    }
    if (newState === RecordingStates.STOPPING) {
      this.state.stopped_at = this.state.updated_at;
    }
    if (newState === RecordingStates.COMPLETED) {
      this.state.completed_at = this.state.updated_at;
    }
    if (newState === RecordingStates.RECOVERING) {
      this.state.recovery_attempts = (this.state.recovery_attempts || 0) + 1;
    }

    Object.assign(this.state, metadata);
    this.persist();

    console.log(`${new Date().toISOString()} [state.transition] ${previousState} -> ${newState}`);
    this.emit('transition', { previous: previousState, current: newState, state: this.state });
  }

  update(metadata = {}) {
    Object.assign(this.state, metadata);
    this.state.updated_at = new Date().toISOString();
    this.persist();
  }

  persist() {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error(`[StateManager] Failed to persist state to ${this.stateFilePath}:`, err.message);
    }
  }

  getSnapshot() {
    return { ...this.state };
  }
}
