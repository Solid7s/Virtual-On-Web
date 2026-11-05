// Exercise real browser contexts, startup failures, and device loss with a local ROM.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rom = process.env.TEST_ROM || path.resolve(__dirname, '../roms/ready/vonu.zip');
const url = new URL(process.env.TEST_URL || 'http://localhost:8084/');
url.searchParams.set('manual', '1');
const out = path.resolve(__dirname, '../build/renderer-check');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const scenario of ['missing', 'throwing-access', 'no-adapter', 'device-rejection', 'pipeline-rejection', 'initial-device-loss', 'runtime-loss', 'neither']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(scenario => {
        if (['missing', 'neither'].includes(scenario)) Object.defineProperty(navigator, 'gpu', { value: undefined });
        if (scenario === 'throwing-access') Object.defineProperty(navigator, 'gpu', { get() { throw Error('WebGPU access failed'); } });
        if (scenario === 'no-adapter') Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => null } });
        if (scenario === 'device-rejection') Object.defineProperty(navigator, 'gpu', { value: {
          requestAdapter: async () => ({ requestDevice: async () => { throw Error('Device creation failed'); } }),
        } });
        if (['pipeline-rejection', 'initial-device-loss', 'runtime-loss'].includes(scenario)) {
          const request = GPUAdapter.prototype.requestDevice;
          GPUAdapter.prototype.requestDevice = async function (...args) {
            const device = await request.apply(this, args);
            window.testDevice = device;
            device.lost.then(() => { window.testDeviceLost = true; });
            return device;
          };
        }
        if (scenario === 'pipeline-rejection') GPUDevice.prototype.createRenderPipelineAsync = async function () {
          throw Error('D3D12 CreateRootSignature failed: DXGI_ERROR_DEVICE_REMOVED');
        };
        if (scenario === 'initial-device-loss') GPUDevice.prototype.createRenderPipelineAsync = async function () {
          this.destroy();
          await this.lost;
          throw Error('Graphics device lost during initialization');
        };
        if (scenario === 'neither') {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return type === 'webgl2' ? null : get.call(this, type, ...args);
          };
        }
      }, scenario);
      await page.goto(url.href);
      await page.setInputFiles('#roms', rom);
      await page.click('#classicMode');
      await page.waitForFunction(() => !document.querySelector('#launch').disabled);
      await page.click('#launch');
      await page.waitForFunction(() => document.querySelector('#runner').contentWindow?.virtualOn
        || document.querySelector('#status').textContent.includes('Graphics unavailable'), null, { timeout: 120000 });
      if (scenario === 'neither') {
        assert.match(await page.locator('#status').innerText(), /WebGPU:.*WebGL 2:/);
        assert.equal(await page.isDisabled('#launch'), false);
        assert.equal(await page.locator('#session').isVisible(), false);
      } else {
        const frame = page.frames().find(f => f.url().includes('virtual-on-player.html'));
        const backend = await frame.evaluate(() => virtualOn.renderer.stats.backend);
        assert.match(backend, scenario === 'runtime-loss' ? /WebGPU$/ : /WebGL 2$/);
        const advance = async n => {
          for (let left = n; left > 0; left -= 30) await frame.evaluate(n => virtualOn.advance(n), Math.min(left, 30));
        };
        await advance(1200);
        if (scenario === 'runtime-loss') {
          const pulse = async key => {
            await frame.locator('#screen').focus();
            await page.keyboard.down(key); await advance(18);
            await page.keyboard.up(key); await advance(18);
          };
          await pulse('Digit5'); await pulse('Digit5'); await pulse('Enter');
          await advance(120); await pulse('ShiftLeft'); await advance(600);
          assert.deepEqual(await frame.evaluate(() => [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)]), [4, 10]);
          const before = await frame.evaluate(async () => {
            virtualOn.renderer.setDisplayMode('enhanced-plus');
            virtualOn.renderer.prepare(Module); virtualOn.advance(1);
            window.beforeModule = Module;
            const canvas = document.querySelector('#screen');
            const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
            const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
            window.beforePixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
            window.beforeLayers = await virtualOn.renderer.readLayers();
            canvas.focus();
            testDevice.destroy();
            return Module._von_frames();
          });
          await frame.waitForFunction(() => virtualOn.renderer.stats.backend.endsWith('WebGL 2'));
          const comparison = await frame.evaluate(() => {
            if (Module !== beforeModule) throw Error('Fallback restarted the board');
            virtualOn.advance(0);
            const pixels = virtualOn.renderer.readPixels(), layers = virtualOn.renderer.readLayers();
            if (pixels.length !== beforePixels.length) throw Error('Fallback changed display dimensions');
            let changed = 0, total = 0, nonblack = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              let different = false;
              for (let c = 0; c < 3; ++c) { const delta = Math.abs(pixels[i+c] - beforePixels[i+c]); total += delta; different ||= delta > 4; }
              changed += different; nonblack += Number(!!(pixels[i] || pixels[i+1] || pixels[i+2]));
            }
            return { frames: Module._von_frames(), focus: document.activeElement.id,
              mode: virtualOn.renderer.stats.displayMode, glError: virtualOn.renderer.getError(), nonblack,
              percent: changed / (pixels.length / 4) * 100, mean: total / (pixels.length / 4 * 3),
              layersMatch: layers.every((data, i) => data.every((v, j) => v === beforeLayers[i][j])),
              statsBackend: Module.model2GpuStats.backend };
          });
          assert.equal(comparison.frames, before);
          assert.equal(comparison.focus, 'screen');
          assert.equal(comparison.mode, 'enhanced-plus');
          assert.equal(comparison.glError, 0);
          assert.ok(comparison.layersMatch, 'Tile layers must match WebGPU exactly');
          assert.ok(comparison.nonblack > 10000);
          assert.ok(comparison.percent < 2.5 && comparison.mean < 1.5, JSON.stringify(comparison));
          assert.match(comparison.statsBackend, /WebGL 2$/);
          await pulse('KeyW');
          assert.ok(await frame.evaluate(() => Module._von_frames()) > before);
          results.push({ scenario, comparison });
        }
        const visible = await frame.evaluate(() => {
          virtualOn.advance(0);
          return virtualOn.renderer.readPixels().some((v, i) => i % 4 < 3 && v !== 0);
        });
        assert.ok(visible, `${scenario}: fallback must draw the game`);
        if (['pipeline-rejection', 'initial-device-loss'].includes(scenario))
          assert.equal(await frame.evaluate(() => testDeviceLost), true, 'Failed WebGPU device must be released');
        await frame.locator('#screen').screenshot({ path: path.join(out, scenario + '.png') });
        await frame.evaluate(() => document.querySelector('#quitGame').click());
        await page.waitForFunction(() => document.querySelector('#session').hidden);
        assert.equal(await page.isDisabled('#launch'), false);
      }
      assert.deepEqual(errors, []);
      results.push({ scenario, passed: true });
      console.log(`${scenario}: passed`);
      await context.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
