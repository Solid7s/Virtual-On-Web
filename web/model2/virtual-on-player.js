import { createGameAudio } from './game-audio.js';
import { createGeneralRenderer } from './gpu-renderer.js';
import { TwinStickState } from './twin-stick.js';
import { importVirtualOn } from './virtual-on-roms.js';
const canvas = document.querySelector('#screen');
const display = document.querySelector('#display'), gameActions = document.querySelector('.game-actions');
const quitButton = document.querySelector('#quitGame'), fullscreenButton = document.querySelector('#toggleFullscreen');
const send = (type, detail = '') => parent.postMessage({ scope: 'model2', type, detail }, location.origin);
const report = text => send('status', text);
const held = new TwinStickState();
const base = new URL('../../build/v3-standalone/', import.meta.url);
let Module, renderer, running = false, started = false, request, last = 0, lag = 0, statTime = 0, statFrames = 0;
let audio, storageKey, autoPaused = false, saveTime = 0;
const frameMS = 1000 * 656 * 424 / 16000000;
let manual = new URLSearchParams(location.search).has('manual');
function save() {
  if (!Module?._von_save_nvram()) return;
  try {
    const bytes = Module.FS.readFile('/virtual-on/nvram.bin');
    localStorage.setItem(storageKey, btoa(String.fromCharCode(...bytes)));
  } catch (err) { send('log', `Arcade settings could not be saved: ${err.message}`); }
}
function pause() {
  running = false; cancelAnimationFrame(request); held.clear();
  void audio?.suspend(); save();
}
function resume() {
  if (!Module || running && !manual) return;
  manual = false; running = true; last = 0; lag = 0;
  statTime = performance.now(); statFrames = Module._von_frames();
  void audio?.resume(); request = requestAnimationFrame(tick);
}
function fail(message) { pause(); report(message); send('error', message); }
function input() {
  const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
  const ports = [255, 255, 255];
  for (const [name, mask, on] of held.read(pad)) if (on) ports[Number(name.at(-1))] &= ~mask;
  ports.forEach((value, port) => Module._von_input(port, value));
}
function advance(count = 1) {
  for (let i = 0; i < count; ++i) {
    input();
    if (!Module._von_frame()) throw Error(Module.UTF8ToString(Module._von_error()));
    if (!manual && audio?.context.state === 'running') {
      const frames = Module._von_audio_count(), pointer = Module._von_audio();
      audio.push(Module.HEAPF32.subarray(pointer/4, pointer/4 + frames*2));
    }
  }
  renderer.draw(Module, Module._von_packet());
}
function tick(now) {
  if (!running) return;
  try {
    renderer.prepare(Module);
    lag += Math.min(now - (last || now), 100); last = now;
    let count = 0;
    while (lag >= frameMS && count < 4) { advance(); lag -= frameMS; ++count; }
    if (now - statTime >= 1000) {
      const frames = Module._von_frames(), fps = (frames - statFrames) * 1000 / (now - statTime);
      window.model2StandaloneStats = { frames, fps, speed: fps * frameMS / 1000, polygons: Module._von_polygons(), standalone: true };
      statTime = now; statFrames = frames;
    }
    if (now - saveTime > 10000) { save(); saveTime = now; }
    request = requestAnimationFrame(tick);
  } catch (err) { fail(err.message); }
}
window.addEventListener('keydown', event => {
  // Let focused toolbar buttons receive Enter/Space and normal Tab navigation.
  if (event.target.closest?.('button')) return;
  if (event.code === 'Tab' && !event.shiftKey && Module) {
    event.preventDefault(); if (!event.repeat) running ? pause() : resume(); return;
  }
  if (running && audio?.context.state === 'suspended') void audio.resume();
  if (held.key(event.code, true)) event.preventDefault();
});
window.addEventListener('keyup', event => {
  if (held.key(event.code, false) && !event.target.closest?.('button')) event.preventDefault();
});
let actionsTimer;
function hideGameActions() {
  clearTimeout(actionsTimer);
  gameActions.classList.remove('is-visible');
}
function showGameActions() {
  clearTimeout(actionsTimer);
  gameActions.classList.add('is-visible');
  actionsTimer = setTimeout(hideGameActions, 2000);
}
display.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') showGameActions(); }, { passive: true });
// Reveal touch controls after the tap so it cannot also activate a hidden button.
display.addEventListener('click', showGameActions);
display.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') hideGameActions(); });
window.addEventListener('blur', () => { held.clear(); hideGameActions(); });
gameActions.addEventListener('focusin', () => held.clear());
quitButton.addEventListener('click', () => { quitButton.disabled = true; send('quit'); });
fullscreenButton.addEventListener('click', () => send('toggle-fullscreen'));
canvas.addEventListener('pointerdown', () => { canvas.focus(); if (running) void audio?.resume(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { autoPaused = running && !manual; if (autoPaused) pause(); }
  else if (autoPaused) { autoPaused = false; resume(); }
});
window.addEventListener('pagehide', () => { if (Module) save(); });
async function boot({ game, archives, displayMode = 'enhanced' }) {
  if (started) return;
  started = true;
  try {
    report('Loading Virtual-On…');
    const [manifest, source] = await Promise.all([
      fetch(new URL('player-wasm/build.json', base)).then(async r => { if (!r.ok) throw Error('Standalone build is missing.'); return (await r.json()).generation; }),
      fetch(new URL('player-wasm/virtual-on-standalone.cjs', base)).then(r => { if (!r.ok) throw Error('Standalone build is missing.'); return r.text(); }),
    ]);
    const script = document.createElement('script');
    script.textContent = source; document.head.append(script);
    Module = window.Module = await window.createVirtualOnStandalone({ noInitialRun: true,
      locateFile: name => new URL(`player-wasm/${name}`, base).href,
      print: line => send('log', line), printErr: line => send('log', line) });
    await importVirtualOn(Module, game, archives, manifest, report);
    archives.length = 0;
    storageKey = `model2-enhanced-v3-standalone-${game}-nvram-v1`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
        if (bytes.length !== 0x4080) throw Error('Invalid saved settings size');
        Module.FS.writeFile('/virtual-on/nvram.bin', bytes);
      }
    } catch (err) { send('log', `Starting with fresh arcade settings: ${err.message}`); }
    if (!Module.ccall('von_init', 'number', ['string', 'number'], ['/virtual-on', Number(game === 'vonj')]))
      throw Error(Module.UTF8ToString(Module._von_error()));
    Module._von_gpu(1);
    renderer = await createGeneralRenderer(canvas, fail, !!Module._von_gpu_projection);
    renderer.stats.backend = 'Standalone Virtual-On + WebGPU';
    renderer.setDisplayMode(displayMode); renderer.prepare(Module);
    audio = await createGameAudio({ legacy: new URLSearchParams(location.search).get('audio') !== 'worklet',
      log: text => send('log', text) });
    void audio.resume();
    Module.model2GpuStats = renderer.stats;
    window.virtualOn = { advance, pause, resume, save, Module, held, renderer, audio };
    running = true; statTime = performance.now();
    report('');
    send('log', 'Standalone compiled i960, SHARC and 68000; native Model 2 board, SCSP sound and Daytona graphics.');
    canvas.focus();
    if (!manual) request = requestAnimationFrame(tick);
  } catch (err) { fail(err.message); }
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.scope !== 'model2') return;
  if (event.data.type === 'boot') void boot(event.data);
  if (event.data.type === 'fullscreen-state') {
    const label = event.data.detail ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-pressed', String(!!event.data.detail));
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.title = label;
  }
  if (event.data.type === 'stop') { pause(); renderer?.destroy(); void audio?.close(); send('exited'); }
});
send('ready');
