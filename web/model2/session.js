// Pure configuration shared by the browser host and ROM-free tests.
export const MAX_ROM_BYTES = 768 * 1024 * 1024;

export function validateFiles(files) {
  if (!files.length) throw Error('Choose one or more ROM ZIPs first.');
  let total = 0;
  const names = new Set();
  return Array.from(files, file => {
    const name = file.name.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]*\.zip$/.test(name) || name.includes('..')) {
      throw Error(`Use a simple MAME set filename, such as vf2.zip: ${file.name}`);
    }
    if (names.has(name)) throw Error(`Duplicate archive: ${name}`);
    names.add(name);
    total += file.size;
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || total > MAX_ROM_BYTES) {
      throw Error('ROM selection is empty or exceeds the 768 MB browser import limit.');
    }
    return { name, file };
  });
}

export function ancestors(game, games) {
  const result = [];
  const seen = new Set([game.id]);
  let parent = game.parent;
  while (parent) {
    if (seen.has(parent)) throw Error('Cycle in ROM parent catalog');
    seen.add(parent);
    result.push(parent);
    parent = games.find(candidate => candidate.id === parent)?.parent;
  }
  return result;
}

// Match MAME set filenames without reading or uploading ROM contents. A parent
// accompanying a split clone is a dependency, not a second game to choose.
export function detectGames(games, files) {
  const names = new Set(validateFiles(files).map(archive => archive.name));
  const matches = games.filter(game => names.has(`${game.id}.zip`));
  const parents = new Set(matches.flatMap(game => ancestors(game, games)));
  return matches.filter(game => !parents.has(game.id));
}

export function validateSelection(game, games, files) {
  if (!game || !games.some(candidate => candidate.id === game.id)) throw Error('Choose a Model 2 game.');
  const archives = validateFiles(files);
  const candidates = [game.id, ...ancestors(game, games)].map(id => `${id}.zip`);
  if (!archives.some(archive => candidates.includes(archive.name))) {
    throw Error(`Include ${candidates.join(' or ')}. MAME checks the ROM contents when it starts.`);
  }
  return archives;
}

export function mameArguments(id, displayMode = 'enhanced', customGamepad = false) {
  if (!/^[a-z0-9_]+$/.test(id)) throw Error('Invalid driver ID');
  if (!['classic', 'enhanced', 'enhanced-plus'].includes(displayMode)) throw Error('Invalid display mode');
  return [id, '-rompath', '/roms', '-nvram_directory', '/model2-enhanced-v3/nvram',
    '-cfg_directory', '/model2-enhanced-v3/cfg', '-state_directory', '/model2-enhanced-v3/states',
    '-snapshot_directory', '/model2-enhanced-v3/snap', '-diff_directory', '/model2-enhanced-v3/diff',
    '-noreadconfig', '-video', 'accel', '-sound', 'js', '-samplerate', '48000',
    '-window', '-resolution', '640x480', '-keepaspect', displayMode === 'classic' ? '-nofilter' : '-filter',
    '-nomouse', '-lightgun', customGamepad ? '-nojoystick' : '-joystick', '-skip_gameinfo',
    // This Wasm build uses the portable C DRC backend, not a native-code JIT.
    // These verified games run faster with the direct SHARC interpreter and
    // its guarded wait-loop batching than with interpreted DRC micro-ops.
    // Per-set profiling and validation: V2_SUMMARY.md and
    // docs/GUNBLADE_PERFORMANCE.md. Untested clones retain their backend.
    ...(['indy500', 'indy500d', 'indy500to', 'von', 'vonj', 'vonu', 'vonr', 'gunblade',
      'fvipers', 'lastbrnx', 'schamp', 'zerogun', 'pltkids', 'dynamcopb',
      'dyndeka2b', 'fvipersb', 'lastbrnxu', 'lastbrnxj', 'sfight', 'zerogunj',
      'dynabb', 'dynabb97'].includes(id) ? ['-nodrc'] : [])];
}
