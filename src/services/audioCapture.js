/**
 * Captures SYSTEM audio (not the microphone) via getDisplayMedia.
 * Down-samples to 16 kHz mono and emits Int16 PCM chunks.
 */
export class SystemAudioCapture {
  constructor(onChunk, onEnded) {
    this.onChunk = onChunk;
    this.onEnded = onEnded || null;
    this.stream = null; // display stream
    this.micStream = null; // microphone stream
    this.ctx = null;
    this.srcNode = null;
    this.micNode = null;
    this.workletNode = null;
    this.running = false;
    this.isMicMuted = false;
  }

  async start() {
    if (this.running) return;

    let stream = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'monitor' },
          audio: true
        });
      }
    } catch (e) {
      console.warn('getDisplayMedia failed or cancelled', e);
    }

    const audioTracks = stream ? stream.getAudioTracks() : [];
    if (stream && audioTracks.length === 0) {
      // User shared screen but no audio
      console.warn('No system audio selected.');
    }

    // drop the video track
    if (stream) {
      stream.getVideoTracks().forEach((t) => t.stop());
    }

    this.stream = stream;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    await this.ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    this.workletNode = new AudioWorkletNode(this.ctx, 'pcm-downsample-processor');
    this.workletNode.port.onmessage = (e) => this.onChunk(e.data);

    // keep the graph alive but silent (no echo of system audio)
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.workletNode.connect(this.gain);
    this.gain.connect(this.ctx.destination);

    if (this.stream && this.stream.getAudioTracks().length > 0) {
      this.srcNode = this.ctx.createMediaStreamSource(this.stream);
      this.srcNode.connect(this.workletNode);

      const audioTrack = this.stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.addEventListener('ended', () => {
          if (this.running) {
            this.stop();
            if (this.onEnded) this.onEnded();
          }
        });
      }
    }

    this.running = true;
  }

  async toggleMicrophone(muted) {
    this.isMicMuted = muted;
    
    // If we want to unmute, and we don't have a mic stream yet, request permission
    if (!muted && !this.micStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (this.ctx && this.running) {
          this.micNode = this.ctx.createMediaStreamSource(this.micStream);
          this.micNode.connect(this.workletNode);
        }
      } catch (err) {
        console.warn('Microphone permission denied', err);
        throw new Error('Microphone permission denied.');
      }
    }

    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(t => t.enabled = !muted);
    }
  }

  stop() {
    this.running = false;
    try {
      if (this.workletNode) this.workletNode.disconnect();
      if (this.srcNode) this.srcNode.disconnect();
      if (this.micNode) this.micNode.disconnect();
      if (this.gain) this.gain.disconnect();
      if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    this.stream = null;
    this.micStream = null;
    this.ctx = null;
    this.srcNode = null;
    this.micNode = null;
    this.workletNode = null;
    this.gain = null;
  }
}
