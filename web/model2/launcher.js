import { detectGames, validateSelection } from './session.js';
import { renderControlsGuide } from './controls-guide.js';
import { renderVirtualOnControls } from './virtual-on-controls.js';
import { virtualOnRevision } from './rom-revisions.js';
import { DISPLAY_MODES } from './display.js';
import { executionEngine } from './engine-profiles.js';

const $ = id => document.getElementById(id);
const videoBackend = 'webgpu';
const virtualOnPage = document.documentElement.dataset.app === 'virtual-on';
const standaloneRequested = virtualOnPage || new URLSearchParams(location.search).get('virtualOnStandalone') === '1';
let games = [], files = [], active = false, enginePresent = false;
let pendingArchives = null, selected = null;
let detection = 0, detecting = false;
const displayModeKey = 'model2-enhanced-v3-display-mode';
const displayDescriptions = {
  classic: 'Original arcade resolution and the classic 4:3 view.',
  enhanced: 'Higher-resolution graphics with the original 4:3 view.',
  'enhanced-plus': 'Higher-resolution graphics with a wider view on widescreen displays.',
};
let displayMode = 'enhanced';
try {
  const saved = localStorage.getItem(displayModeKey);
  if (DISPLAY_MODES.includes(saved)) displayMode = saved;
} catch { /* The switch still works when browser storage is unavailable. */ }
function describeDisplay() {
  document.querySelectorAll('[data-mode]').forEach(button => {
    const selected = button.dataset.mode === displayMode;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  const description = $('graphicsDescription');
  if (description) description.textContent = displayDescriptions[displayMode];
}
function selectDisplay(mode) {
  displayMode = mode;
  try { localStorage.setItem(displayModeKey, displayMode); } catch { /* Session-only preference. */ }
  describeDisplay();
}
document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => selectDisplay(button.dataset.mode));
  button.addEventListener('keydown', event => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? DISPLAY_MODES.length - 1
      : (DISPLAY_MODES.indexOf(displayMode) + step + DISPLAY_MODES.length) % DISPLAY_MODES.length;
    selectDisplay(DISPLAY_MODES[index]);
    document.querySelector(`[data-mode="${displayMode}"]`).focus();
  });
});
describeDisplay();
function renderGuide() {
  if (virtualOnPage) {
    renderVirtualOnControls($('controls'));
    return;
  }
  renderControlsGuide(selected, { standalone: standaloneRequested });
}
renderGuide();
const logLines = [];
function log(line) {
  logLines.push(String(line));
  if (logLines.length > 250) logLines.shift();
  $('log').textContent = logLines.join('\n');
}
function message(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}
function status(text) { message('status', text); }
function updateButton() {
  let valid = false;
  if (selected && files.length) {
    try { validateSelection(selected, games, files); valid = true; } catch { /* File detection explains invalid selections. */ }
  }
  $('launch').disabled = active || detecting || !enginePresent || !valid;
  // A cleared/invalid selection or a stopped session must never leave an
  // empty game screen on the landing page. Launch reveals it after selection.
  if (!active) $('session').hidden = true;
}
async function detectSelectedFiles() {
  const request = ++detection;
  selected = null;
  detecting = files.length > 0;
  renderGuide();
  message('romDetection', '');
  updateButton();
  if (!files.length) return;
  try {
    let matches = detectGames(games, files);
    if (matches.length === 1 && matches[0].id === 'von') {
      message('romDetection', 'Checking Virtual-On ROM revision…');
      const revision = await virtualOnRevision(files.find(file => file.name.toLowerCase() === 'von.zip'),
        { compiledOnly: standaloneRequested });
      if (request !== detection) return;
      if (revision) matches = games.filter(game => game.id === revision);
    }
    if (matches.length === 1) {
      if (virtualOnPage && !['vonu', 'vonj'].includes(matches[0].id)) {
        throw Error('Choose the Virtual-On parent archive, von.zip, containing USA or Japan Revision B. For a split set, also select its vonu.zip or vonj.zip.');
      }
      selected = matches[0];
      validateSelection(selected, games, files);
      message('romDetection', `Detected: ${selected.title}`);
    } else if (matches.length > 1) {
      message('romDetection', 'Multiple games detected. Choose the ZIP files for one game at a time.');
    } else {
      message('romDetection', virtualOnPage
        ? 'Choose the Virtual-On parent ROM archive, von.zip.'
        : 'Game not recognized. Use the original ROM ZIP filename, such as vf2.zip.');
    }
  } catch (err) {
    if (request !== detection) return;
    selected = null;
    message('romDetection', err.message);
  }
  if (request !== detection) return;
  detecting = false;
  renderGuide();
  updateButton();
}
$('roms').addEventListener('change', event => {
  files = Array.from(event.target.files);
  if (enginePresent) status('');
  if (games.length) detectSelectedFiles();
  else {
    message('romDetection', files.length ? 'Loading game list…' : '');
    updateButton();
  }
});
$('launch').addEventListener('click', async () => {
  if ($('launch').disabled) return;
  try {
    const chosen = validateSelection(selected, games, files);
    active = true;
    $('selection').disabled = true;
    updateButton();
    status('Reading ROM files locally…');
    logLines.length = 0;
    log(`Requested ${selected.id} (${selected.board}); awaiting engine ROM verification.`);
    log(`Display: ${displayMode}; requested renderer: ${videoBackend}.`);
    pendingArchives = await Promise.all(chosen.map(async ({ name, file }) => ({ name, bytes: await file.arrayBuffer() })));
    $('session').hidden = false;
    const engine = executionEngine(selected.id, videoBackend);
    const standalone = ['vonu', 'vonj'].includes(selected.id) && standaloneRequested;
    log(`Execution: ${standalone ? 'standalone compiled Virtual-On' : engine}.`);
    const options = new URLSearchParams(), query = new URLSearchParams(location.search);
    if (query.has('manual')) options.set('manual', '1');
    if (['legacy', 'worklet'].includes(query.get('audio'))) options.set('audio', query.get('audio'));
    const manual = options.size ? `?${options}` : '';
    $('runner').src = new URL(standalone ? `./virtual-on-player.html${manual}`
      : engine === 'daytona-compiled' ? '../../daytona.html?embedded=1' : './runner.html', import.meta.url).href;
    $('stop').disabled = false;
  } catch (err) {
    active = false; $('selection').disabled = false; updateButton(); status(err.message); log(err.message);
  }
});
function quitGame() {
  if (!active || $('stop').disabled) return;
  $('stop').disabled = true;
  status(virtualOnPage ? 'Saving and quitting…' : 'Stopping the emulator and saving…');
  $('runner').contentWindow.postMessage({ scope: 'model2', type: 'stop' }, location.origin);
}
$('stop').addEventListener('click', quitGame);
async function toggleFullscreen() {
  const runner = $('runner');
  try {
    if (document.fullscreenElement === runner) await document.exitFullscreen();
    else await runner.requestFullscreen();
    runner.contentDocument?.querySelector('#screen, #canvas')?.focus();
  } catch (err) { status(err.message); }
}
$('fullscreen').addEventListener('click', toggleFullscreen);
function updateFullscreenFooter() {
  const runner = $('runner');
  const fullscreen = document.fullscreenElement === runner;
  const footer = runner.contentDocument?.querySelector('footer');
  if (footer) footer.hidden = fullscreen;
  $('fullscreen').textContent = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
  runner.contentWindow.postMessage({ scope: 'model2', type: 'fullscreen-state', detail: fullscreen }, location.origin);
}
document.addEventListener('fullscreenchange', updateFullscreenFooter);
$('runner').addEventListener('load', updateFullscreenFooter);
window.addEventListener('message', async event => {
  if (event.origin !== location.origin || event.source !== $('runner').contentWindow || event.data?.scope !== 'model2') return;
  const { type, detail } = event.data;
  if (type === 'ready' && pendingArchives) {
    const archives = pendingArchives; pendingArchives = null;
    event.source.postMessage({ scope: 'model2', type: 'boot', game: selected.id, inputs: selected.inputs, displayMode, videoBackend, archives }, location.origin,
      archives.map(archive => archive.bytes));
  } else if (type === 'status') status(detail);
  else if (type === 'log') log(detail);
  else if (type === 'quit') quitGame();
  else if (type === 'toggle-fullscreen') await toggleFullscreen();
  else if (type === 'fallback') {
    try {
      log(`Compiled engine unavailable: ${detail}. Starting general engine.`);
      pendingArchives = await Promise.all(validateSelection(selected, games, files)
        .map(async ({ name, file }) => ({ name, bytes: await file.arrayBuffer() })));
      if (!active) return;
      $('runner').src = new URL('./runner.html', import.meta.url).href;
    } catch (err) {
      status(err.message); log(err.message); active = false;
      $('selection').disabled = false; $('stop').disabled = true; updateButton();
    }
  }
  else if (type === 'error') {
    status(detail); log(detail);
    active = false; pendingArchives = null;
    $('selection').disabled = false; $('stop').disabled = true;
    if (document.fullscreenElement === $('runner')) await document.exitFullscreen().catch(err => log(err.message));
    $('runner').src = 'about:blank';
    $('session').hidden = true; updateButton();
  }
  else if (type === 'exited') {
    active = false;
    $('selection').disabled = false;
    $('stop').disabled = true;
    if (document.fullscreenElement === $('runner')) await document.exitFullscreen().catch(err => log(err.message));
    $('runner').src = 'about:blank';
    $('session').hidden = true;
    status(detail ? 'The game could not start. Check that all required ROM ZIP files are selected.' : virtualOnPage ? 'Game closed.' : 'Session stopped.');
    updateButton();
    if (virtualOnPage) $('launch').focus();
  }
});

async function init() {
  try {
    const response = await fetch(new URL('./catalog.json', import.meta.url));
    if (!response.ok) throw Error('Could not load the Model 2 catalog.');
    const catalog = await response.json();
    games = catalog.games;
    if (files.length) detectSelectedFiles();
    const urls = standaloneRequested
      ? ['player-wasm/build.json', 'player-wasm/virtual-on-standalone.cjs', 'player-wasm/virtual-on-standalone.wasm']
        .map(file => new URL(`../../build/v3-standalone/${file}`, import.meta.url))
      : ['model2.js', 'model2.wasm'].map(file => new URL(`../../engines/mame/${file}`, import.meta.url));
    const checks = await Promise.all(urls.map(url => fetch(url, { method: 'HEAD' })));
    enginePresent = checks.every(response => response.ok);
    if (!enginePresent) status('The emulator is unavailable. Reload the page to try again.');
    updateButton();
  } catch (err) { status(err.message); log(err.message); }
}
init();
