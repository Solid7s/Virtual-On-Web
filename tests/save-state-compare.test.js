import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import comparison from './save-state-compare.cjs';

const scsp = 'Yamaha YMF292-F SCSP/:scsp/';
const schema = [
  ['cpu/register', 4], ['timer/test/0/m_enabled', 1], ['timer/test/0/m_index', 4],
  ...['9', 'A', 'B'].map(index => [`${scsp}${index}/m_udata.data[i]`, 2]),
  [`${scsp}0/m_dma.dmea`, 4],
].map(([name, size]) => ({ name, size, count: 1, blocks: 1 }));
function save({ cpu = 123, enabled = 0, index = 1, dmaRegister = 0, dmaAddress = 0 } = {}) {
  const data = Buffer.alloc(19);
  data.writeUInt32LE(cpu, 0); data[4] = enabled; data.writeUInt32LE(index, 5);
  data.writeUInt16LE(dmaRegister, 9); data.writeUInt32LE(dmaAddress, 15);
  return Buffer.concat([Buffer.alloc(32), deflateSync(data)]);
}
test('only disabled timer indices and unused DMA storage are excluded', () => {
  const result = comparison.compareSaveStates(save(), save({ index: 999, dmaAddress: 55 }), schema);
  assert.equal(result.equal, true);
  assert.equal(result.ignoredDifferences.length, 2);
  assert.equal(result.referenceHash, result.candidateHash);
});
test('CPU differences and active timer order remain significant', () => {
  assert.equal(comparison.compareSaveStates(save(), save({ cpu: 124 }), schema).equal, false);
  const result = comparison.compareSaveStates(save({ enabled: 1 }), save({ enabled: 1, index: 2 }), schema);
  assert.deepEqual(result.differences.map(field => field.name), ['timer/test/0/m_index']);
});
test('DMA state remains significant once DMA registers are in use', () => {
  const result = comparison.compareSaveStates(save({ dmaRegister: 1 }), save({ dmaRegister: 1, dmaAddress: 55 }), schema);
  assert.deepEqual(result.differences.map(field => field.name), [`${scsp}0/m_dma.dmea`]);
});
test('incomplete serialization schemas cannot produce a passing comparison', () => {
  assert.throws(() => comparison.compareSaveStates(save(), save(), schema.slice(0, -1)), /entire serialized state/);
});
