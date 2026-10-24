// Stereo PCM queue at the game's native 44.1 kHz. No allocation in render().
export class AudioRing {
  constructor(rate = 44100) {
    this.capacity = 16384;
    this.samples = new Float32Array(this.capacity * 2);
    this.target = Math.ceil(rate * .04);
    this.maximum = Math.ceil(rate * .25);
    this.read = 0; this.size = 0; this.playing = false; this.started = false;
    this.received = 0; this.played = 0; this.underruns = 0; this.silent = 0; this.dropped = 0;
  }
  reset() { this.read = 0; this.size = 0; this.playing = false; this.started = false; }
  push(samples, frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames * 2 > samples.length || frames > this.maximum) return;
    this.received += frames;
    // Resynchronize after a long main-thread burst; never build unbounded latency.
    if (this.size + frames > this.maximum) {
      const drop = Math.min(this.size, this.size + frames - this.target);
      this.read = (this.read + drop) % this.capacity; this.size -= drop; this.dropped += drop;
    }
    let write = (this.read + this.size) % this.capacity;
    for (let i = 0; i < frames; ++i) {
      this.samples[write * 2] = samples[i * 2]; this.samples[write * 2 + 1] = samples[i * 2 + 1];
      write = (write + 1) % this.capacity;
    }
    this.size += frames;
  }
  render(left, right) {
    left.fill(0); right.fill(0);
    if (!this.playing && this.size >= this.target) { this.playing = true; this.started = true; }
    if (!this.playing) { if (this.started) this.silent += left.length; return; }
    const count = Math.min(left.length, this.size);
    for (let i = 0; i < count; ++i) {
      left[i] = this.samples[this.read * 2]; right[i] = this.samples[this.read * 2 + 1];
      this.read = (this.read + 1) % this.capacity;
    }
    this.size -= count; this.played += count;
    if (count < left.length) { this.playing = false; ++this.underruns; this.silent += left.length - count; }
  }
  stats() {
    return { received: this.received, played: this.played, queued: this.size,
      underruns: this.underruns, silent: this.silent, dropped: this.dropped };
  }
}
