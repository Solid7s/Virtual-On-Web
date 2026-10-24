// One persistent worklet, with transferable buffers recycled between threads.
// Works on ordinary HTTPS/GitHub Pages: SharedArrayBuffer is not required.
export async function createGameAudio({ legacy = true, log = () => {} } = {}) {
  let context;
  if (legacy) context = new AudioContext();
  else {
    try { context = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' }); }
    catch { context = new AudioContext(); }
  }
  const sources = new Set(), pool = [];
  const stats = { mode: 'buffer-source', sampleRate: context.sampleRate, buffers: 0, sources: 0,
    submitted: 0, poolMisses: 0, transportDropped: 0, received: 0, played: 0, queued: 0, underruns: 0, silent: 0, dropped: 0 };
  let node, next = 0, closed = false;
  // Preserve browser-quality resampling on devices that reject 44.1 kHz.
  // A worklet queue must not play 44.1 kHz samples at a different sample rate.
  if (!legacy && context.sampleRate === 44100 && context.audioWorklet) {
    try {
      await context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
      node = new AudioWorkletNode(context, 'virtual-on-audio', { numberOfInputs: 0, numberOfOutputs: 1,
        outputChannelCount: [2] });
      node.port.onmessage = ({ data }) => {
        if (closed) return;
        if (data.type === 'recycle') pool.push(data.buffer);
        if (data.type === 'stats') { const { type, ...values } = data; Object.assign(stats, values); }
      };
      node.onprocessorerror = () => {
        if (closed || !node) return;
        node.disconnect(); node.port.close(); node = undefined; stats.mode = 'buffer-source'; next = 0;
        log('Audio worklet stopped; using browser audio playback.');
      };
      node.connect(context.destination); stats.mode = 'worklet';
      for (let i = 0; i < 16; ++i) pool.push(new ArrayBuffer(1024 * 2 * 4));
      stats.buffers = pool.length;
    } catch (error) {
      node?.disconnect(); node?.port.close(); node = undefined;
      log(`Using browser audio playback: ${error.message}`);
    }
  }
  function reset() {
    next = 0; node?.port.postMessage({ type: 'reset' });
    for (const source of sources) { source.stop(); source.disconnect(); }
    sources.clear();
  }
  return {
    context, stats,
    push(samples) {
      if (closed || context.state !== 'running') return;
      const frames = samples.length / 2; stats.submitted += frames;
      if (node) {
        // The emulated video frame contains 766 or 767 stereo samples. Split
        // larger batches without allocating additional transport buffers.
        for (let offset = 0; offset < frames; offset += 1024) {
          const count = Math.min(1024, frames - offset), buffer = pool.pop();
          if (!buffer) { ++stats.poolMisses; stats.transportDropped += frames - offset; return; }
          new Float32Array(buffer).set(samples.subarray(offset * 2, (offset + count) * 2));
          node.port.postMessage({ type: 'samples', frames: count, buffer }, [buffer]);
        }
      } else {
        const buffer = context.createBuffer(2, frames, 44100); ++stats.buffers;
        for (let c = 0; c < 2; ++c) {
          const target = buffer.getChannelData(c);
          for (let n = 0; n < frames; ++n) target[n] = samples[n * 2 + c];
        }
        const source = context.createBufferSource(); ++stats.sources;
        source.buffer = buffer; source.connect(context.destination); sources.add(source);
        source.onended = () => { sources.delete(source); source.disconnect(); };
        if (next < context.currentTime || next > context.currentTime + .3) next = context.currentTime + .04;
        source.start(next); next += frames / 44100;
      }
    },
    reset,
    suspend() { reset(); return context.suspend(); },
    resume() { return context.resume(); },
    close() {
      if (closed) return;
      closed = true; reset(); node?.disconnect(); node?.port.close(); pool.length = 0;
      return context.close();
    },
  };
}
