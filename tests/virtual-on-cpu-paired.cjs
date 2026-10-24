// Adjacent, equal-frame CPU comparisons inside one throttled browser thread.
// Includes game CPU, sound, geometry and CPU render preparation. Excludes GPU
// presentation/audio scheduling: use virtual-on-performance.cjs for game speed.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
if (!process.env.TEST_SPECS && !process.env.TEST_SPECS_FILE && (!process.env.TEST_BASELINE || !process.env.TEST_CANDIDATE)) throw Error('Set TEST_SPECS, TEST_SPECS_FILE or TEST_BASELINE and TEST_CANDIDATE.');
const output = path.resolve(process.env.TEST_OUTPUT || 'build/paired-cpu.json');
const rate = Number(process.env.TEST_CPU_RATE || 3);
const specs = process.env.TEST_SPECS_FILE ? JSON.parse(fs.readFileSync(process.env.TEST_SPECS_FILE)) : process.env.TEST_SPECS ? JSON.parse(process.env.TEST_SPECS) : [{ name: 'backup', engine: process.env.TEST_BASELINE },
  { name: 'aot', engine: process.env.TEST_CANDIDATE, blocks: 1 },
  { name: 'no-blocks', engine: process.env.TEST_CANDIDATE, blocks: 0 }];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const records = [], errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://localhost:8084/');
    await page.evaluate(async () => {
      window.cpuRom = {};
      for (const name of ['vonu', 'vonj', 'main-data', 'copro-data', 'polygons', 'textures', 'sound-program', 'samples']) {
        const response = await fetch(`/build/v3-standalone/${name}.bin`);
        if (!response.ok) throw Error(`Missing local input: ${name}`);
        cpuRom[name] = new Uint8Array(await response.arrayBuffer());
      }
      window.cpuCases = [];
    });
    for (const [i, spec] of specs.entries()) {
      await page.route(`**/cpu-test-${i}.wasm`, route => route.fulfill({
        path: path.resolve(spec.engine, 'virtual-on-standalone.wasm'), contentType: 'application/wasm' }));
      await page.addScriptTag({ content: fs.readFileSync(path.resolve(spec.engine, 'virtual-on-standalone.cjs'), 'utf8') });
      await page.evaluate(async ({ i, blocks, projection, japan, checksums }) => {
        const m = await createVirtualOnStandalone({ noInitialRun: true,
          locateFile: () => new URL(`/cpu-test-${i}.wasm`, location.href).href });
        m.FS.mkdir('/game');
        for (const [name, data] of Object.entries(cpuRom)) m.FS.writeFile(`/game/${name}.bin`, data);
        if (!m.ccall('von_init', 'number', ['string', 'number'], ['/game', japan])) throw Error(m.UTF8ToString(m._von_error()));
        if (checksums === 0 && !m._von_audio_checksums) throw Error('Checksum-off case requires checksum control');
        m._von_audio_checksums?.(checksums ?? 1);
        m._von_gpu(1); m._von_gpu_tiles(1);
        if (blocks !== undefined) m._von_blocks(blocks);
        if (projection !== undefined) m._von_gpu_projection(projection);
        cpuCases.push(m);
      }, { i, blocks: spec.blocks, projection: spec.projection, checksums: spec.checksums, japan: Number(process.env.TEST_GAME === 'vonj') });
    }
    const advance = async (count, port0 = 255, stick = 255) => {
      for (let n = 0; n < count; n += 30) await page.evaluate(({ count, port0, stick }) => {
        for (const m of cpuCases) {
          m._von_input(0, port0); m._von_input(1, stick); m._von_input(2, 255);
          for (let i = 0; i < count; ++i) if (!m._von_frame()) throw Error(m.UTF8ToString(m._von_error()));
        }
      }, { count: Math.min(30, count - n), port0, stick });
    };
    await advance(1200);
    await advance(18, 254); await advance(18); await advance(18, 254); await advance(18);
    await advance(18, 239); await advance(18); await advance(120);
    await advance(18, 255, 254); await advance(18); await advance(600);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    // Alternate short adjacent chunks to reduce drift between engines. The
    // emulated workload and state match at every boundary, regardless of order.
    for (let round = 0; round < Number(process.env.TEST_ROUNDS || 24); ++round) {
      const sample = await page.evaluate(round => {
        const order = cpuCases.map((_, i) => i), ms = [];
        if (round % 2) order.reverse();
        for (const i of order) {
          const m = cpuCases[i], start = performance.now();
          for (let n = 0; n < 30; ++n) if (!m._von_frame()) throw Error(m.UTF8ToString(m._von_error()));
          ms[i] = performance.now() - start;
        }
        // Compare PCM after timing, including cases with diagnostics disabled.
        const pcm = m => m.HEAPU8.subarray(m._von_audio(), m._von_audio() + m._von_audio_count()*8);
        const expected = pcm(cpuCases[0]);
        for (const m of cpuCases.slice(1)) {
          const actual = pcm(m);
          if (actual.length !== expected.length || !actual.every((v, i) => v === expected[i])) throw Error('PCM mismatch');
        }
        return { round, frames: 30, ms };
      }, round);
      if (round % 6 === 5) {
        const states = await page.evaluate(() => cpuCases.map(m => JSON.parse(m.UTF8ToString(m._von_state()))));
        for (const [i, state] of states.entries()) {
          if (specs[i].checksums === 0) assert.equal(state.audio, null);
          else assert.equal(typeof state.audio, 'string');
          const { audio, ...rest } = state, { audio: referenceAudio, ...reference } = states[0];
          assert.deepEqual(rest, reference);
          const enabledState = states.find((_, j) => specs[j].checksums !== 0);
          if (specs[i].checksums !== 0) assert.equal(audio, enabledState.audio);
        }
        sample.state = states[0];
      }
      records.push(sample);
      console.log(JSON.stringify(sample.state ? { round, matched: true, ms: sample.ms } : sample));
    }
    assert.deepEqual(errors, []);
    const counters = await page.evaluate(() => cpuCases.map(m => m._von_block_instructions?.() || 0));
    for (const [i, spec] of specs.entries()) {
      if (spec.blocks === 1) assert.ok(counters[i] > 100000);
      if (spec.blocks === 0) assert.equal(counters[i], 0);
    }
    const dsp = await page.evaluate(() => cpuCases.map(m => m._von_dsp_info ? JSON.parse(m.UTF8ToString(m._von_dsp_info())) : null));
    const audioCounters = await page.evaluate(() => cpuCases.map(m => ({
      total: m._von_audio_total(), hashed: m._von_audio_hashed_frames?.() ?? null })));
    for (const [i, counter] of audioCounters.entries()) {
      if (counter.hashed !== null) assert.equal(counter.hashed, specs[i].checksums === 0 ? 0 : counter.total);
    }
    fs.writeFileSync(output, JSON.stringify({ browser: browser.version(), rate,
      specs: specs.map(s => ({ ...s, artifacts: JSON.parse(fs.readFileSync(path.resolve(s.engine, 'build.json'))).artifacts })),
      records, counters, dsp, audioCounters, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
