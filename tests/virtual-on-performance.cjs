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
    const specs = [{ name: 'backup', engine: baseline, tiles: 0 },
      { name: 'cpu', engine: candidate, tiles: 0 }, { name: 'cpu-gpu', engine: candidate, tiles: 1 }];
    if (process.env.TEST_GPU_ONLY) specs.push({ name: 'gpu', engine: process.env.TEST_GPU_ONLY, tiles: 1 });
    const selected = process.env.TEST_CASES ? specs.filter(s => process.env.TEST_CASES.split(',').includes(s.name)) : specs;
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
        await page.goto((process.env.TEST_URL || 'http://localhost:8084/') + '?manual=1');
        await page.setInputFiles('#roms', process.env.TEST_ROM || path.join(root, 'roms/ready', game + '.zip'));
        await page.locator(`[data-mode="${mode}"]`).click();
        await page.waitForFunction(() => !document.querySelector('#launch').disabled);
        await page.click('#launch');
        await page.waitForFunction(() => document.querySelector('#runner').contentWindow?.virtualOn, null, { timeout: 120000 })
          .catch(async e => { console.error(await page.locator('#log').textContent()); throw e; });
        const frame = page.frames().find(f => f.url().includes('virtual-on-player.html'));
        await frame.evaluate(tiles => Module._von_gpu_tiles?.(tiles), spec.tiles);
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
          if (reference.has(name)) assert.deepEqual(record, reference.get(name), `${spec.name}: ${name} must preserve state, audio and every pixel`);
          else reference.set(name, record);
        };
        await advance(1200); await checkpoint('attract');
        await pulse('Digit5'); await pulse('Digit5'); await pulse('Enter'); await advance(120); await checkpoint('selection');
        await pulse('ShiftLeft'); await advance(600); await checkpoint('combat');
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        await frame.evaluate(() => virtualOn.resume()); await page.waitForTimeout(3000);
        const read = () => frame.evaluate(() => ({ frames: Module._von_frames(), time: performance.now(),
          scene: [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)], gpu: { ...virtualOn.renderer.stats } }));
        const start = await read(), samples = [];
        for (let s=0; s<seconds; ++s) { await page.waitForTimeout(1000); samples.push(await read()); }
        await frame.evaluate(() => virtualOn.pause()); const end = await read();
        const speed = (end.frames-start.frames)*17.384/(end.time-start.time);
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => runtimeErrors), []);
        assert.ok(samples.every(s => String(s.scene)==='4,10'), 'Timing samples must stay in combat');
        const record = { name: spec.name, engine: path.resolve(spec.engine), gpuTiles: spec.tiles,
          artifacts: JSON.parse(fs.readFileSync(path.resolve(spec.engine, 'build.json'))).artifacts,
          round, mode, rate, browser: browser.version(), speed,
          elapsed: (end.time-start.time)/1000, emulatedFrames: end.frames-start.frames, start, end, samples, checkpoints, errors };
        records.push(record);
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(records, null, 2));
        console.log(JSON.stringify({ name: spec.name, round, speed, adapter: end.gpu.adapter, resolution: end.gpu.resolution,
          layerBytes: end.gpu.layerUploadBytes-start.gpu.layerUploadBytes, tileBytes: end.gpu.tileUploadBytes-start.gpu.tileUploadBytes }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
