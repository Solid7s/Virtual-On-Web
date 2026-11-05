// Compare player/renderer changes against saved JS files, using the same Wasm,
// ROM and real inputs. Keep compilation and other benchmarks idle while timing.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build/webgl-performance');
const baseline = process.env.TEST_BASELINE || path.join(out, 'baseline');
const cases = (process.env.TEST_CASES || 'baseline,candidate').split(',');
const modes = (process.env.TEST_MODES || 'classic,enhanced-plus').split(',');
const rounds = Number(process.env.TEST_ROUNDS || 2), seconds = Number(process.env.TEST_SECONDS || 12);
const dpr = Number(process.env.TEST_DPR || 2), rate = Number(process.env.TEST_CPU_RATE || 1);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const records = [], reference = new Map();
  try {
    for (const mode of modes) for (let round = 0; round < rounds; round++)
      for (const variant of round % 2 ? [...cases].reverse() : cases) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
        try {
          const page = await context.newPage(), errors = [];
          page.on('pageerror', e => errors.push(e.message));
          await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
          if (variant === 'baseline') for (const name of ['virtual-on-player.js', 'webgl-renderer.js'])
            await page.route(`**/web/model2/${name}`, route => route.fulfill({ path: path.join(baseline, name), contentType: 'text/javascript' }));
          await page.goto((process.env.TEST_URL || 'http://localhost:8084/') + '?manual=1');
          await page.setInputFiles('#roms', process.env.TEST_ROM || path.join(root, 'roms/ready/vonu.zip'));
          await page.locator(`[data-mode="${mode}"]`).click();
          await page.waitForFunction(() => !document.querySelector('#launch').disabled);
          await page.click('#launch');
          await page.waitForFunction(() => document.querySelector('#runner').contentWindow?.virtualOn, null, { timeout: 120000 });
          const frame = page.frames().find(f => f.url().includes('virtual-on-player.html'));
          const advance = async count => {
            for (let left = count; left > 0; left -= 30) await frame.evaluate(n => virtualOn.advance(n), Math.min(left, 30));
          };
          const pulse = async key => {
            await frame.evaluate(key => virtualOn.held.key(key, true), key); await advance(18);
            await frame.evaluate(key => virtualOn.held.key(key, false), key); await advance(18);
          };
          const checkpoint = async name => {
            const record = await frame.evaluate(async () => {
              virtualOn.advance(0);
              const pixels = virtualOn.renderer.readPixels();
              const layers = virtualOn.renderer.readLayers();
              const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
              return { state: JSON.parse(Module.UTF8ToString(Module._von_state())), pixels: await hash(pixels),
                layers: await Promise.all(layers.map(hash)), resolution: virtualOn.renderer.stats.resolution };
            });
            const key = `${mode}-${name}`;
            if (!reference.has(key)) reference.set(key, record);
            else {
              const prior = reference.get(key);
              assert.deepEqual(record.state, prior.state, `${key}: CPU, memory and cumulative audio`);
              assert.deepEqual(record.layers, prior.layers, `${key}: tile layers`);
              if (record.resolution === prior.resolution) assert.equal(record.pixels, prior.pixels, `${key}: every pixel`);
            }
            return record;
          };
          await advance(1200); const attract = await checkpoint('attract');
          await pulse('Digit5'); await pulse('Digit5'); await pulse('Enter'); await advance(120);
          const selection = await checkpoint('selection');
          await pulse('ShiftLeft'); await advance(600); const combat = await checkpoint('combat');
          assert.deepEqual(await frame.evaluate(() => [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)]), [4, 10]);
          const cdp = await context.newCDPSession(page);
          if (rate !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
          await frame.evaluate(() => {
            const timings = window.timings = { frame: 0, draw: 0, frameCalls: 0, drawCalls: 0 };
            const frame = Module._von_frame;
            Module._von_frame = () => { const start = performance.now(); const result = frame(); timings.frame += performance.now() - start; timings.frameCalls++; return result; };
            const draw = virtualOn.renderer.draw.bind(virtualOn.renderer);
            virtualOn.renderer.draw = (...args) => { const start = performance.now(); const result = draw(...args); timings.draw += performance.now() - start; timings.drawCalls++; return result; };
            virtualOn.resume();
          });
          await page.waitForTimeout(2000);
          const read = () => frame.evaluate(() => ({ frames: Module._von_frames(), time: performance.now(),
            stats: { ...virtualOn.renderer.stats }, timings: { ...timings }, scene: [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)] }));
          const start = await read();
          await page.waitForTimeout(seconds * 1000);
          const end = await read(); await frame.evaluate(() => virtualOn.pause());
          assert.deepEqual(end.scene, [4, 10]); assert.deepEqual(errors, []);
          const elapsed = end.time - start.time, frames = end.frames - start.frames;
          const result = { variant, round, mode, dpr, rate, seconds: elapsed / 1000,
            speed: frames * 17.384 / elapsed, fps: frames * 1000 / elapsed,
            frameMS: (end.timings.frame - start.timings.frame) / frames,
            drawMS: (end.timings.draw - start.timings.draw) / (end.timings.drawCalls - start.timings.drawCalls),
            draws: end.timings.drawCalls - start.timings.drawCalls,
            browser: browser.version(), resolution: end.stats.resolution, adapter: end.stats.adapter, checkpoints: { attract, selection, combat } };
          records.push(result);
          fs.writeFileSync(path.join(out, process.env.TEST_REPORT || 'report.json'), JSON.stringify(records, null, 2));
          const { checkpoints, ...summary } = result; console.log(JSON.stringify(summary));
        } finally { await context.close(); }
      }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
