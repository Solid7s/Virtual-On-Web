import { AudioRing } from './audio-ring.js';
class VirtualOnAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new AudioRing(sampleRate); this.untilStats = sampleRate;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') this.ring.reset();
      if (data.type === 'samples') {
        this.ring.push(new Float32Array(data.buffer), data.frames);
        this.port.postMessage({ type: 'recycle', buffer: data.buffer }, [data.buffer]);
      }
    };
  }
  process(inputs, outputs) {
    const channels = outputs[0];
    if (channels.length === 2) {
      this.ring.render(channels[0], channels[1]);
      this.untilStats -= channels[0].length;
      if (this.untilStats <= 0) {
        this.untilStats += sampleRate;
        this.port.postMessage({ type: 'stats', ...this.ring.stats() });
      }
    }
    return true;
  }
}
registerProcessor('virtual-on-audio', VirtualOnAudio);
