import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ancestors, detectGames, mameArguments, validateFiles, validateSelection, MAX_ROM_BYTES } from '../web/model2/session.js';

const { games } = JSON.parse(readFileSync(new URL('../web/model2/catalog.json', import.meta.url)));
const file = (name, size = 100) => ({ name, size });
test('catalog covers all four boards and keeps upstream compatibility separate from verification', () => {
  assert.equal(games.length, 90);
  assert.equal(new Set(games.map(game => game.id)).size, 90);
  assert.deepEqual([...new Set(games.map(game => game.board))].sort(), ['Model 2', 'Model 2A', 'Model 2B', 'Model 2C']);
  for (const id of ['vf2', 'doa', 'doaa', 'srallyc', 'vcop', 'vcop2', 'hotd', 'manxtt']) assert.ok(games.find(game => game.id === id));
  assert.ok(games.every(game => !('playable' in game) && !('browserTested' in game)));
  assert.equal(games.find(game => game.id === 'hotd').upstreamWorking, false);
});
test('merged parents and split clones are accepted, unrelated files are rejected', () => {
  const game = games.find(game => game.id === 'vf2a');
  assert.deepEqual(ancestors(game, games), ['vf2']);
  assert.equal(validateSelection(game, games, [file('vf2.zip')]).length, 1);
  assert.equal(validateSelection(game, games, [file('vf2a.zip'), file('vf2.zip')]).length, 2);
  assert.throws(() => validateSelection(game, games, [file('daytona.zip')]), /Include vf2a.zip or vf2.zip/);
});
test('ROM filenames identify every catalog set, case-insensitively, with extra BIOS archives', () => {
  for (const game of games) {
    assert.deepEqual(detectGames(games, [file(`${game.id.toUpperCase()}.ZIP`), file('model2.zip')]).map(g => g.id), [game.id]);
  }
});
test('split clone detection ignores its parent; multiple clones or unrelated games stay ambiguous', () => {
  const ids = names => detectGames(games, names.map(name => file(`${name}.zip`))).map(g => g.id).sort();
  assert.deepEqual(ids(['vf2', 'vf2a']), ['vf2a']);
  assert.deepEqual(ids(['vf2a', 'vf2']), ['vf2a']);
  assert.deepEqual(ids(['vf2']), ['vf2']); // a merged ZIP defaults to its named set
  assert.deepEqual(ids(['vf2', 'vf2a', 'vf2b']), ['vf2a', 'vf2b']);
  assert.deepEqual(ids(['hotdo', 'gunblade']), ['gunblade', 'hotdo']);
  assert.deepEqual(ids(['unknown', 'model2']), []);
  assert.throws(() => detectGames(games, [file('vf2.zip', 0)]), /empty/);
});
test('import rejects paths, duplicates, empty selections and excessive memory before reading bytes', () => {
  for (const name of ['../vf2.zip', '/vf2.zip', 'roms/vf2.zip', 'a\\vf2.zip', 'a..b.zip', 'vf2.7z']) {
    assert.throws(() => validateFiles([file(name)]));
  }
  assert.throws(() => validateFiles([]));
  assert.throws(() => validateFiles([file('vf2.zip', 0)]));
  assert.throws(() => validateFiles([file('vf2.zip'), file('VF2.ZIP')]));
  assert.throws(() => validateFiles([file('vf2.zip', MAX_ROM_BYTES), file('vcop.zip')]));
  assert.equal(validateFiles([file('VF2.ZIP')])[0].name, 'vf2.zip');
});
test('MAME gets the actual selected driver and its own persistence namespace', () => {
  const args = mameArguments('vf2a');
  assert.equal(args[0], 'vf2a');
  assert.equal(args[args.indexOf('-rompath') + 1], '/roms');
  assert.equal(args[args.indexOf('-nvram_directory') + 1], '/model2-enhanced-v3/nvram');
  assert.ok(!args.includes('daytona'));
  assert.throws(() => mameArguments('../daytona'));
  assert.throws(() => mameArguments('vf2 -rompath /'));
});
test('catalog cycles cannot hang the launcher', () => {
  const circular = [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }];
  assert.throws(() => ancestors(circular[0], circular), /Cycle/);
});
test('verified SHARC games use the direct interpreter in every display mode', () => {
  const verified = new Set(['indy500', 'indy500d', 'indy500to', 'von', 'vonj', 'vonu', 'vonr', 'gunblade',
    'fvipers', 'lastbrnx', 'schamp', 'zerogun', 'pltkids', 'dynamcopb',
    'dyndeka2b', 'fvipersb', 'lastbrnxu', 'lastbrnxj', 'sfight', 'zerogunj',
    'dynabb', 'dynabb97']);
  assert.equal(games.filter(game => verified.has(game.id)).length, verified.size);
  for (const game of games) {
    const direct = verified.has(game.id);
    if (direct) assert.equal(game.board, 'Model 2B', game.id);
    for (const mode of ['classic', 'enhanced', 'enhanced-plus']) {
      assert.equal(mameArguments(game.id, mode).includes('-nodrc'), direct, game.id);
    }
  }
});
test('Classic disables smoothing and Enhanced enables it without changing the arcade view', () => {
  const classic = mameArguments('vf2', 'classic');
  const enhanced = mameArguments('vf2', 'enhanced');
  assert.ok(classic.includes('-nofilter'));
  assert.ok(enhanced.includes('-filter'));
  assert.deepEqual(classic.filter(arg => arg !== '-nofilter'), enhanced.filter(arg => arg !== '-filter'));
  assert.ok(classic.includes('-keepaspect'));
  assert.deepEqual(mameArguments('vf2'), enhanced);
  assert.deepEqual(mameArguments('vf2', 'enhanced-plus'), enhanced);
  assert.throws(() => mameArguments('vf2', 'unknown'), /Invalid display mode/);
});
