import test from 'node:test';
import assert from 'node:assert/strict';
import { executionEngine } from '../web/model2/engine-profiles.js';

test('only validated Daytona profile selects the compiled engine', () => {
  assert.equal(executionEngine('daytona', 'webgpu'), 'daytona-compiled');
  for (const id of ['daytona93', 'daytonam', 'srallyc', 'vcop2', 'vonu', 'indy500'])
    assert.equal(executionEngine(id, 'webgpu'), 'general');
  assert.equal(executionEngine('daytona', 'software'), 'general');
  assert.equal(executionEngine('daytona', 'webgpu', 'general'), 'general');
  assert.throws(() => executionEngine('daytona', 'webgpu', 'unknown'));
});
