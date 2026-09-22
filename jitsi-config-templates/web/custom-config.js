// ==============================================================================
// Custom Jitsi Meet Configuration: Auto-Pin Screen Share & Crystal Clear Audio
// ==============================================================================

// 1. Force auto-pin of screenshare so Jibri and attendees always focus on slides
config.disableFollowMe = true;
config.autoPinLatestScreenShare = 'remote-only';
config.channelLastN = -1;

// 2. Prevent video suspension ("Video has been turned off to save bandwidth")
config.videoQuality = config.videoQuality || {};
config.videoQuality.enableAdaptiveMode = false;
config.videoQuality.codecPreferenceOrder = ['VP8', 'H264', 'VP9'];
config.videoQuality.screenshareCodec = 'VP8';

// 3. Audio quality and noise suppression
config.disableAP = false; // Keep WebRTC Echo Cancellation, Noise Suppression, and AGC active
config.disableAGC = false;
config.audioQuality = {
    stereo: false,
    opusMaxAverageBitrate: 128000,
    enableAdvancedAudioSettings: true
};
