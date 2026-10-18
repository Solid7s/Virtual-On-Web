import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programEngine } from '../web/model2/program-engine.js';

test('only compiled Virtual-On USA/Japan programs select the AOT engine', async () => {
  for (const game of ['vonu', 'vonj']) assert.equal((await programEngine(game, '', async () => true)).compiled, true);
  for (const game of ['von', 'daytona', 'vf2', 'srallyc']) {
    assert.equal((await programEngine(game, '', () => { throw Error('Unrelated core was probed'); })).compiled, false);
  }
});
test('missing assets, network errors and the reference override retain the general engine', async () => {
  assert.equal((await programEngine('vonu', '?virtualOnAot=0', async () => true)).compiled, false);
  assert.equal((await programEngine('vonu', '', async name => name.endsWith('.js'))).compiled, false);
  assert.equal((await programEngine('vonu', '', async () => { throw Error('offline'); })).compiled, false);
});
