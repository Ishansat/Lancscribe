const CHUNK_SAMPLES = 8192;

function downsampleTo16k(input, fromRate) {
  const ratio = fromRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = input[Math.floor(i * ratio)];
  }
  return out;
}

class PcmDownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._bufferedLength = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    this._chunks.push(channel.slice());
    this._bufferedLength += channel.length;

    if (this._bufferedLength >= CHUNK_SAMPLES) {
      const merged = new Float32Array(this._bufferedLength);
      let offset = 0;
      for (const part of this._chunks) {
        merged.set(part, offset);
        offset += part.length;
      }
      this._chunks = [];
      this._bufferedLength = 0;

      const out = downsampleTo16k(merged, sampleRate);
      if (out.length > 0) {
        const buf = new ArrayBuffer(out.length * 2);
        const view = new DataView(buf);
        for (let i = 0; i < out.length; i++) {
          const s = Math.max(-1, Math.min(1, out[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        this.port.postMessage(buf, [buf]);
      }
    }

    return true;
  }
}

registerProcessor('pcm-downsample-processor', PcmDownsampleProcessor);
