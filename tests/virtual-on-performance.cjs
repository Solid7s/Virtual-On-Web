// Before/after CPU-throttled browser comparison. Supply the backed-up engine
// with TEST_BASELINE and the candidate with TEST_CANDIDATE (directories).
// No profiler is attached: sampling changes timing and Wasm compilation tiers.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const baseline = process.env.TEST_BASELINE;
if (!baseline) throw Error('Set TEST_BASELINE to the backed-up player-wasm directory.');
const candidate = process.env.TEST_CANDIDATE || path.join(root, 'build/v3-standalone/player-wasm');
const out = process.env.TEST_OUTPUT || path.join(root, 'build/performance-comparison');
const rounds = Number(process.env.TEST_ROUNDS || 2), seconds = Number(process.env.TEST_SECONDS || 20);
const rate = Number(process.env.TEST_CPU_RATE || 2), mode = process.env.TEST_MODE || 'classic';
const game = process.env.TEST_GAME || 'vonu';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const records = [], reference = new Map();
  try {
    const specs = [{ name: 'backup', engine: baseline, tiles: Number(process.env.TEST_BASELINE_TILES || 0) },
      { name: 'cpu', engine: candidate, tiles: 0 }, { name: 'cpu-gpu', engine: candidate, tiles: 1 }];
    specs.push({ name: 'aot', engine: candidate, tiles: 1, blocks: 1 },
      { name: 'no-blocks', engine: candidate, tiles: 1, blocks: 0 });
    if (process.env.TEST_GPU_ONLY) specs.push({ name: 'gpu', engine: process.env.TEST_GPU_ONLY, tiles: 1 });
    const selected = process.env.TEST_SPECS_FILE ? JSON.parse(fs.readFileSync(process.env.TEST_SPECS_FILE))
      : specs.filter(s => (process.env.TEST_CASES || 'backup,cpu,cpu-gpu').split(',').includes(s.name));
    for (let round = 0; round < rounds; ++round) for (const spec of round % 2 ? [...selected].reverse() : selected) {
      const context = await browser.newContext({ viewport: { width: Number(process.env.TEST_WIDTH || 1920), height: Number(process.env.TEST_HEIGHT || 1080) }, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(() => {
          window.runtimeErrors = [];
          addEventListener('message', event => {
            if (event.origin === location.origin && event.data?.scope === 'model2' && event.data.type === 'error')
              runtimeErrors.push(event.data.detail);
          });
        });
        await page.route('**/build/v3-standalone/player-wasm/*', route => {
          const name = path.basename(new URL(route.request().url()).pathname);
          return route.fulfill({ path: path.resolve(spec.engine, name), contentType: name.endsWith('.wasm') ? 'application/wasm'
            : name.endsWith('.json') ? 'application/json' : 'text/javascript' });
        });
        if (spec.frontend) await page.route('**/web/model2/virtual-on-player.js', route =>
          route.fulfill({ path: path.resolve(spec.frontend, 'web/model2/virtual-on-player.js'), contentType: 'text/javascript' }));
        await page.goto((process.env.TEST_URL || 'http://localhost:8084/') + '?manual=1' +
          (['legacy', 'worklet'].includes(spec.audio) ? '&audio=' + spec.audio : ''));
        await page.setInputFiles('#roms', process.env.TEST_ROM || path.join(root, 'roms/ready', game + '.zip'));
        await page.locator(`[data-mode="${mode}"]`).click();
        await page.waitForFunction(() => !document.querySelector('#launch').disabled);
        await page.click('#launch');
        await page.waitForFunction(() => document.querySelector('#runner').contentWindow?.virtualOn, null, { timeout: 120000 })
          .catch(async e => { console.error(await page.locator('#log').textContent()); throw e; });
        const frame = page.frames().find(f => f.url().includes('virtual-on-player.html'));
        // Checkpoint validation includes historical cumulative audio hashes.
        await frame.evaluate(() => Module._von_audio_checksums?.(1));
        await frame.evaluate(tiles => Module._von_gpu_tiles?.(tiles), spec.tiles);
        if (spec.blocks !== undefined) await frame.evaluate(enabled => Module._von_blocks(enabled), spec.blocks);
        if (spec.projection !== undefined) await frame.evaluate(mode => Module._von_gpu_projection(mode), spec.projection);
        if (process.env.TEST_PROJECTION !== undefined && spec.name !== 'backup')
          await frame.evaluate(mode => Module._von_gpu_projection(Number(mode)), process.env.TEST_PROJECTION);
        const advance = async n => { for (let left=n; left>0; left-=30) await frame.evaluate(n => virtualOn.advance(n), Math.min(30, left)); };
        const pulse = async key => {
          await frame.evaluate(key => virtualOn.held.key(key, true), key); await advance(18);
          await frame.evaluate(key => virtualOn.held.key(key, false), key); await advance(18);
        };
        const checkpoints = [];
        const checkpoint = async name => {
          const data = await frame.evaluate(async () => {
            const layers = await virtualOn.renderer.readLayers();
            const hashes = await Promise.all(layers.map(async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')));
            return { state: JSON.parse(Module.UTF8ToString(Module._von_state())), layers: hashes };
          });
          const png = await frame.locator('#screen').screenshot();
          const record = { name, ...data, image: sha(png) }; checkpoints.push(record);
          fs.writeFileSync(path.join(out, `${spec.name}-${round}-${name}.png`), png);
          if (reference.has(name)) {
            const expected = reference.get(name);
            assert.deepEqual(record.state, expected.state, `${spec.name}: ${name} state and audio`);
            assert.deepEqual(record.layers, expected.layers, `${spec.name}: ${name} tile layers`);
            if (record.image !== expected.image && process.env.TEST_PIXEL_REPORT === '1') {
              // Explicit diagnostic mode reports differences without claiming
              // pixel equivalence. State/audio/layer comparisons stay strict.
              record.pixelDifference = await page.evaluate(async ({ a, b }) => {
                const decode = async data => {
                  const blob = await (await fetch('data:image/png;base64,' + data)).blob();
                  const image = await createImageBitmap(blob), canvas = document.createElement('canvas');
                  canvas.width = image.width; canvas.height = image.height;
                  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
                  return ctx.getImageData(0, 0, canvas.width, canvas.height);
                };
                const [x, y] = await Promise.all([decode(a), decode(b)]);
                if (x.width !== y.width || x.height !== y.height) throw Error('Screenshot dimensions differ');
                let pixels = 0, maximum = 0, total = 0;
                for (let i = 0; i < x.data.length; i += 4) {
                  let changed = false;
                  for (let c = 0; c < 3; ++c) {
                    const d = Math.abs(x.data[i+c] - y.data[i+c]); changed ||= d !== 0;
                    maximum = Math.max(maximum, d); total += d;
                  }
                  if (changed) ++pixels;
                }
                return { pixels, totalPixels: x.width*x.height, maximumChannelDifference: maximum,
                  meanChannelDifference: total/(x.width*x.height*3) };
              }, { a: reference.get(name + ':png').toString('base64'), b: png.toString('base64') });
              console.log(JSON.stringify({ name: spec.name, checkpoint: name, pixelDifference: record.pixelDifference }));
            } else assert.equal(record.image, expected.image, `${spec.name}: ${name} every pixel`);
          }
          else reference.set(name, record);
          if (!reference.has(name + ':png')) reference.set(name + ':png', png);
        };
        await advance(1200); await checkpoint('attract');
        await pulse('Digit5'); await pulse('Digit5'); await pulse('Enter'); await advance(120); await checkpoint('selection');
        await pulse('ShiftLeft'); await advance(600); await checkpoint('combat');
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        // Optional fixed-work CPU measurement. Each engine executes exactly
        // the same frames, including emulated audio and render preparation.
        // GPU presentation and browser audio scheduling are excluded here;
        // the realtime measurement below still includes both.
        const fixedFrameCpu = [];
        if (process.env.TEST_FIXED_FRAMES) {
          for (let run = 0; run < 3; ++run) fixedFrameCpu.push(await frame.evaluate(count => {
            const start = performance.now();
            for (let i = 0; i < count; ++i)
              if (!Module._von_frame()) throw Error(Module.UTF8ToString(Module._von_error()));
            return { frames: count, ms: performance.now() - start };
          }, Number(process.env.TEST_FIXED_FRAMES)));
          await frame.evaluate(() => virtualOn.advance(0));
          await checkpoint('fixed-work');
        }
        // Timed gameplay uses the production setting unless explicitly overridden.
        // Fixed-work checkpoints above retain checksums for exact comparison.
        const checksumControl = await frame.evaluate(enabled => {
          Module._von_audio_checksums?.(enabled);
          return !!Module._von_audio_checksums;
        }, spec.checksums ?? 0);
        if (spec.checksums === 0) assert.ok(checksumControl, 'Checksum-off case requires checksum control');
        await frame.evaluate(() => virtualOn.resume()); await page.waitForTimeout(3000);
        const read = () => frame.evaluate(() => ({ frames: Module._von_frames(), time: performance.now(),
          scene: [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)],
          audio: virtualOn.audio ? { ...virtualOn.audio.stats } : null,
          audioFrames: Module._von_audio_total(), audioHashedFrames: Module._von_audio_hashed_frames?.() ?? null,
          sharcMathInstructions: Module._von_sharc_math_instructions?.() || 0,
          blockInstructions: Module._von_block_instructions?.() || 0, gpu: { ...virtualOn.renderer.stats } }));
        const start = await read(), samples = [];
        for (let s=0; s<seconds; ++s) { await page.waitForTimeout(1000); samples.push(await read()); }
        await frame.evaluate(() => virtualOn.pause()); const end = await read();
        const speed = (end.frames-start.frames)*17.384/(end.time-start.time);
        if (spec.blocks === 1) assert.ok(end.blockInstructions > start.blockInstructions,
          'AOT measurement must actually execute compiled blocks');
        if (spec.blocks === 0) assert.equal(end.blockInstructions, 0, 'Disabled blocks must stay disabled');
        if (checksumControl) assert.equal(end.audioHashedFrames-start.audioHashedFrames,
          spec.checksums === 1 ? end.audioFrames-start.audioFrames : 0, 'Checksum work must match requested setting');
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => runtimeErrors), []);
        assert.ok(samples.every(s => String(s.scene)==='4,10'), 'Timing samples must stay in combat');
        const record = { name: spec.name, engine: path.resolve(spec.engine), gpuTiles: spec.tiles, audio: spec.audio, frontend: spec.frontend,
          artifacts: JSON.parse(fs.readFileSync(path.resolve(spec.engine, 'build.json'))).artifacts,
          round, mode, rate, blocks: spec.blocks, checksums: checksumControl ? (spec.checksums ?? 0) : 1,
          fixedFrameCpu, browser: browser.version(), speed,
          elapsed: (end.time-start.time)/1000, emulatedFrames: end.frames-start.frames, start, end, samples, checkpoints, errors };
        records.push(record);
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(records, null, 2));
        console.log(JSON.stringify({ name: spec.name, round, speed, adapter: end.gpu.adapter, resolution: end.gpu.resolution,
          layerBytes: end.gpu.layerUploadBytes-start.gpu.layerUploadBytes, tileBytes: end.gpu.tileUploadBytes-start.gpu.tileUploadBytes }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
