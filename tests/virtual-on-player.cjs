// Real ZIP import, boot, inputs and rendered gameplay through the standalone
// browser entry point. No MAME engine or recorded frames are served.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const romDirectory = process.env.TEST_ROM_DIR || path.join(root, 'roms/ready');
const game = process.argv[2] || 'vonu';
const romFile = process.env.TEST_ROM || path.join(romDirectory, `${game}.zip`);
const mode = process.argv[3] || 'classic';
const core = process.env.TEST_CORE || 'player-wasm';
const progression = process.env.TEST_PROGRESSION === '1';
const moveFrames = Number(process.env.TEST_MOVE_FRAMES || (game === 'vonu' ? 60 : 30));
const out = path.join(root, `build/v3-standalone/play-${game}-${mode}${core === 'player-wasm' ? '' : '-' + core}${progression ? '-progression' : ''}`);
const artifacts = JSON.parse(fs.readFileSync(path.join(root, `build/v3-standalone/${core}/build.json`))).artifacts;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] });
  const records = [], errors = [], requests = [], scenes = [];
  let page, passed = false;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    if (core !== 'player-wasm') await page.route('**/build/v3-standalone/player-wasm/*', route => route.fulfill({
      path: path.join(root, 'build/v3-standalone', core, path.basename(new URL(route.request().url()).pathname)) }));
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'GET' && /\.wasm|engines\//.test(r.url())) requests.push(r.url()); });
    const url = new URL(process.env.TEST_URL || 'http://localhost:8084/');
    url.searchParams.set('manual', '1');
    await page.goto(url.href);
    assert.equal(await page.locator('#session').isVisible(), false, 'The landing page must hide the game screen');
    assert.equal(await page.locator('#runner').getAttribute('src'), 'about:blank');
    assert.equal(await page.isDisabled('#launch'), true);
    assert.equal(await page.locator('#stop').innerText(), 'Quit');
    await page.locator('.brand img').evaluate(image => image.decode());
    await page.screenshot({ path: path.join(out, 'landing-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'landing-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setInputFiles('#roms', { name: 'daytona.zip', mimeType: 'application/zip', buffer: Buffer.from('unsupported game') });
    await page.waitForFunction(() => document.querySelector('#romDetection').textContent.includes('Virtual-On'));
    assert.equal(await page.isDisabled('#launch'), true, 'The Virtual-On page must reject other games');
    assert.equal(await page.locator('#session').isVisible(), false);
    await page.setInputFiles('#roms', path.join(romDirectory, `${game === 'vonu' ? 'vonj' : 'vonu'}.zip`));
    await page.waitForFunction(() => !document.querySelector('#launch').disabled);
    await page.setInputFiles('#roms', []);
    assert.equal(await page.isDisabled('#launch'), true, 'Clearing the selector must disable launch');
    assert.equal(await page.locator('#session').isVisible(), false);
    await page.setInputFiles('#roms', romFile);
    await page.click({ classic: '#classicMode', enhanced: '#enhancedMode', 'enhanced-plus': '#enhancedPlusMode' }[mode]);
    await page.waitForFunction(() => !document.querySelector('#launch').disabled);
    assert.equal(await page.locator('#session').isVisible(), false, 'The selected ROM must wait for Launch');
    await page.click('#launch');
    await page.waitForFunction(() => document.querySelector('#runner').contentWindow?.virtualOn
      || /failed|missing|unsupported|error/i.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
    const frame = page.frames().find(f => f.url().includes('/virtual-on-player.html'));
    assert.ok(await frame.evaluate(() => !!window.virtualOn), await page.locator('#log').textContent());
    const assertBrowserLayout = async () => {
      assert.deepEqual(await page.locator('#runner').boundingBox(), { x: 0, y: 0, ...page.viewportSize() },
        'The game must fill the browser viewport');
      assert.equal(await page.locator('.brand').isVisible(), false);
      assert.equal(await page.locator('#controlsGuide').isVisible(), false);
      assert.equal(await page.locator('.copyright-notice').isVisible(), false);
      assert.equal(await page.locator('#fullscreen').isVisible(), false, 'Use the in-game toolbar while playing');
    };
    await assertBrowserLayout();
    assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'Launch must stay inside the browser window');
    await frame.locator('#screen').focus();
    for (const [key, port, mask] of [['KeyW', 'IN1', 32], ['KeyA', 'IN1', 128], ['KeyS', 'IN1', 16], ['KeyD', 'IN1', 64],
      ['KeyP', 'IN2', 32], ['KeyL', 'IN2', 128], ['Semicolon', 'IN2', 16], ['Quote', 'IN2', 64],
      ['ShiftLeft', 'IN1', 1], ['ShiftRight', 'IN2', 1]]) {
      await page.keyboard.down(key);
      assert.deepEqual(await frame.evaluate(() => virtualOn.held.read(null).filter(field => field[2]).map(field => field.slice(0, 2))),
        [[port, mask]], `${key} must reach its assigned arcade input`);
      await page.keyboard.up(key);
      assert.deepEqual(await frame.evaluate(() => virtualOn.held.read(null).filter(field => field[2])), [], `${key} must release`);
    }
    for (const key of ['KeyW', 'KeyP', 'ShiftLeft', 'ShiftRight', 'Space']) await page.keyboard.down(key);
    assert.deepEqual(await frame.evaluate(() => virtualOn.held.read(null).filter(field => field[2]).map(field => field.slice(0, 2))),
      [['IN1', 32], ['IN1', 1], ['IN1', 2], ['IN2', 32], ['IN2', 1], ['IN2', 2]], 'Movement, weapons and Space dash must combine');
    for (const key of ['KeyW', 'KeyP', 'ShiftLeft', 'ShiftRight', 'Space']) await page.keyboard.up(key);
    assert.deepEqual(await frame.evaluate(() => virtualOn.held.read(null).filter(field => field[2])), []);
    const advance = async count => {
      for (let left = count; left > 0; left -= 30) {
        const state = await frame.evaluate(n => {
          virtualOn.advance(n);
          return { frames: Module._von_frames(), polygons: Module._von_polygons(), scene: [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)] };
        }, Math.min(left, 30));
        if (state.frames % 120 === 0) console.log(JSON.stringify(state));
      }
    };
    const shot = async name => {
      await frame.locator('#screen').screenshot({ path: path.join(out, name + '.png') });
      records.push(await frame.evaluate(name => ({ name, frames: Module._von_frames(), polygons: Module._von_polygons(),
        scene: [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)], audioPeak: Module._von_audio_peak(),
        foregroundPixels: (() => { const packet = new Uint32Array(Module.HEAPU8.buffer, Module._von_packet(), 24);
          return new Uint32Array(Module.HEAPU8.buffer, packet[8], 496*384).reduce((n, p) => n + Number(p !== 0), 0); })(),
        audioFrames: Module._von_audio_total(), soundCommands: Module._von_sound_commands(), gpu: { ...virtualOn.renderer.stats } }), name));
    };
    const pulse = async key => {
      await frame.locator('#screen').focus(); await page.keyboard.down(key); await advance(18);
      await page.keyboard.up(key); await advance(18);
    };
    await advance(Number(process.env.TEST_BOOT_FRAMES || 1200)); await shot('attract');
    await pulse('Digit5'); await pulse('Digit5'); await pulse('Enter');
    await advance(120); await shot('selection');
    await pulse('ShiftLeft'); await advance(600); await shot('fight');
    if (progression) {
      // Match the real-input Node replay, whose regional movement patterns
      // win the first fight. Extra opening inputs change the opponent's AI.
      await advance(36);
    } else {
      await pulse('KeyW'); await pulse('KeyP'); await pulse('Space');
      await advance(120);
    }
    await shot('action');
    if (progression) {
      let state, prior = '', resultFrame = 0;
      while ((state?.frames || 0) < 10000) {
        state = await frame.evaluate(moveFrames => {
          // Hold/release real weapon inputs; no health, result or stage patches.
          const n = Module._von_frames(), on = n%30 < 20;
          virtualOn.held.key('ShiftLeft', on); virtualOn.held.key('ShiftRight', on);
          const move = n%120 < moveFrames;
          virtualOn.held.key('KeyW', move); virtualOn.held.key('KeyP', move);
          virtualOn.advance(Math.min(on ? 20-n%30 : 30-n%30, move ? moveFrames-n%120 : 120-n%120));
          return { frames: Module._von_frames(), scene: [Module._von_peek(0x5039f4), Module._von_peek(0x503a00)],
            stage: Module._von_peek(0x503a80), result: Module._von_peek(0x503ab0) };
        }, moveFrames);
        if (String(state.scene) !== prior) {
          prior = String(state.scene); scenes.push(state); console.log(JSON.stringify(state));
          if (state.scene[0] === 4 && [11, 21, 12].includes(state.scene[1]) && !resultFrame) {
            resultFrame = state.frames;
            assert.equal(state.result, state.scene[1] === 11 ? 0 : 3, 'Must win the first match');
          }
          if (resultFrame) await shot(`transition-${state.frames}-${state.scene.join('-')}`);
        }
        if (resultFrame && state.frames >= resultFrame+120 && !records.some(r => r.name === 'result')) await shot('result');
        if (resultFrame && state.scene[0] === 4 && state.scene[1] === 10) {
          assert.ok(state.stage > 0, 'The next fight must advance the stage');
          await advance(1100); await shot('next-match'); break;
        }
      }
      assert.ok(resultFrame, 'Must reach a match result');
      assert.ok(records.some(r => r.name === 'next-match'), `Must progress into the next match: ${JSON.stringify(scenes)}`);
      await frame.evaluate(() => { virtualOn.held.clear(); });
    }
    assert.ok(records.some(r => r.polygons > 100), 'Game must produce real 3D geometry');
    assert.deepEqual(records.find(r => r.name === 'selection').scene, [4, 4], 'Must reach character selection');
    assert.deepEqual(records.find(r => r.name === 'fight').scene, [4, 10], 'Must reach a controllable fight');
    assert.ok(records.find(r => r.name === 'fight').foregroundPixels > 1000, 'Combat HUD must be present');
    assert.ok(records.at(-1).audioPeak > .01, 'Game must produce audible PCM');
    assert.ok(records.at(-1).soundCommands > 50, 'Sound CPU must receive the actual game commands');
    assert.deepEqual(errors, []);
    assert.equal(requests.filter(url => url.endsWith('.wasm')).length, 1);
    assert.ok(requests.some(url => url.includes('player-wasm/virtual-on-standalone.wasm')));
    assert.ok(!requests.some(url => /engines\/.*\.wasm/.test(url)), 'Standalone test must not load a MAME engine');
    const cached = await frame.locator('#screen').screenshot();
    await frame.evaluate(() => {
      Module.model2ForceLayerUpload = Module.model2ForceTextureUpload = true;
      virtualOn.advance(0);
    });
    assert.deepEqual(await frame.locator('#screen').screenshot(), cached, 'Upload caching must preserve every displayed pixel');
    await frame.evaluate(() => { Module.model2ForceLayerUpload = Module.model2ForceTextureUpload = false; });
    if (!process.env.TEST_REALTIME_SECONDS) {
      for (const displayMode of ['classic', 'enhanced', 'enhanced-plus']) {
        await frame.evaluate(mode => {
          virtualOn.renderer.setDisplayMode(mode); virtualOn.renderer.prepare(Module); virtualOn.advance(2);
        }, displayMode);
        await shot(`mode-${displayMode}`);
      }
    }
    if (process.env.TEST_REALTIME_SECONDS) {
      await frame.locator('#toggleFullscreen').click();
      await page.waitForFunction(() => document.fullscreenElement === document.querySelector('#runner')
        && !document.querySelector('#runner').contentDocument.querySelector('footer'));
      assert.equal(await frame.locator('footer').count(), 0, 'The game must have no status bar');
      const profiler = await page.context().newCDPSession(page);
      await profiler.send('Profiler.enable'); await profiler.send('Profiler.start');
      const start = await frame.evaluate(() => { virtualOn.resume(); return { frame: Module._von_frames(), time: performance.now() }; });
      await frame.locator('#screen').focus();
      for (const key of ['Space', 'ShiftLeft', 'ShiftRight']) await page.keyboard.down(key);
      await page.waitForTimeout(Number(process.env.TEST_REALTIME_SECONDS)*1000);
      for (const key of ['Space', 'ShiftLeft', 'ShiftRight']) await page.keyboard.up(key);
      const end = await frame.evaluate(() => { virtualOn.pause(); return { frame: Module._von_frames(), time: performance.now(), stats: window.model2StandaloneStats }; });
      fs.writeFileSync(path.join(out, 'combat.cpuprofile'), JSON.stringify((await profiler.send('Profiler.stop')).profile));
      await profiler.detach();
      records.push({ name: 'realtime', seconds: (end.time-start.time)/1000, frames: end.frame-start.frame,
        speed: (end.frame-start.frame)*.017384/((end.time-start.time)/1000), stats: end.stats });
      await shot('fullscreen');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250);
      await page.keyboard.press('Tab');
      const paused = await frame.evaluate(() => Module._von_frames());
      await page.waitForTimeout(250);
      assert.equal(await frame.evaluate(() => Module._von_frames()), paused, 'Pause must stop emulation');
      await page.evaluate(() => document.exitFullscreen());
    }
    await frame.evaluate(() => virtualOn.save());
    const saved = await page.evaluate(game => localStorage.getItem(`model2-enhanced-v3-standalone-${game}-nvram-v1`), game);
    assert.equal(Buffer.from(saved, 'base64').length, 0x4080);
    const square = frame.locator('#toggleFullscreen');
    assert.equal(await frame.locator('#quitGame').isVisible(), true);
    assert.equal(await square.isVisible(), true);
    await frame.locator('#display').screenshot({ path: path.join(out, 'toolbar-windowed.png') });
    await square.click();
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('#runner'));
    await frame.waitForFunction(() => document.querySelector('#toggleFullscreen').getAttribute('aria-pressed') === 'true');
    assert.equal(await frame.locator('footer').count(), 0);
    assert.equal(await square.getAttribute('aria-label'), 'Exit fullscreen');
    assert.equal(await frame.evaluate(() => document.activeElement.id), 'screen', 'Fullscreen must return focus to the game');
    await frame.evaluate(() => { virtualOn.renderer.prepare(Module); virtualOn.advance(0); });
    await frame.locator('#display').screenshot({ path: path.join(out, 'toolbar-fullscreen.png') });
    await square.click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await frame.waitForFunction(() => document.querySelector('#toggleFullscreen').getAttribute('aria-pressed') === 'false');
    assert.equal(await frame.locator('footer').count(), 0, 'Leaving fullscreen must not restore a status bar');
    await assertBrowserLayout();
    // Shift+Tab reaches the toolbar from the game; Space activates the button
    // instead of sending a dash input to the arcade hardware.
    await frame.locator('#screen').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await frame.evaluate(() => document.activeElement.id), 'toggleFullscreen');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('#runner'));
    assert.deepEqual(await frame.evaluate(() => virtualOn.held.read(null).filter(field => field[2])), []);
    await square.click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await square.click();
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('#runner'));
    await frame.waitForFunction(() => document.querySelector('#toggleFullscreen').getAttribute('aria-pressed') === 'true');
    await page.evaluate(game => localStorage.removeItem(`model2-enhanced-v3-standalone-${game}-nvram-v1`), game);
    await frame.locator('#quitGame').click();
    await page.waitForFunction(() => document.querySelector('#session').hidden);
    assert.equal(await page.evaluate(() => document.fullscreenElement === null), true, 'Quit must leave fullscreen');
    assert.equal(await page.isDisabled('#launch'), false, 'Quit must make the launcher usable again');
    assert.equal(await page.locator('.brand').isVisible(), true);
    assert.equal(await page.locator('#controlsGuide').isVisible(), true);
    assert.equal(await page.locator('.copyright-notice').isVisible(), true);
    const quitSave = await page.evaluate(game => localStorage.getItem(`model2-enhanced-v3-standalone-${game}-nvram-v1`), game);
    assert.equal(Buffer.from(quitSave, 'base64').length, 0x4080, 'The X button must save arcade settings');
    await page.click('#launch');
    await page.waitForFunction(() => document.querySelector('#runner').contentWindow?.virtualOn, null, { timeout: 120000 });
    await page.frameLocator('#runner').locator('#quitGame').click();
    await page.waitForFunction(() => document.querySelector('#session').hidden);
    assert.equal(await page.isDisabled('#launch'), false, 'Quit must still work after relaunch');
    assert.deepEqual(errors, []);
    passed = true;
    console.log(JSON.stringify(records));
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ date: new Date().toISOString(), passed, artifacts, game, mode, progression, moveFrames, scenes, records, errors, requests,
      log: page ? await page.locator('#log').textContent().catch(() => '') : '' }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
