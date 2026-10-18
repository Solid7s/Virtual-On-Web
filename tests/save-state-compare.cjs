// Compare serialized MAME state, excluding only identified uninitialized storage.
// Pinned MAME schedule.cpp initializes/saves m_index only for active timers.
// Pinned scsp.cpp leaves m_dma uninitialized; its registers at 0x12/14/16
// initialize those fields when written. Keep every other byte significant.
const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');
const { createHash } = require('node:crypto');

function compareSaveStates(reference, candidate, schema) {
  assert.deepEqual(candidate.subarray(0, 32), reference.subarray(0, 32), 'Save headers differ');
  const left = inflateSync(reference.subarray(32));
  const right = inflateSync(candidate.subarray(32));
  assert.equal(right.length, left.length, 'Serialized state sizes differ');
  const fields = new Map();
  let offset = 0;
  for (const entry of schema) {
    const length = entry.size * entry.count * entry.blocks;
    assert.ok(!fields.has(entry.name), `Duplicate save field ${entry.name}`);
    fields.set(entry.name, { offset, length, left: left.subarray(offset, offset + length),
      right: right.subarray(offset, offset + length) });
    offset += length;
  }
  assert.equal(offset, left.length, 'Schema must cover the entire serialized state');
  const zeroInBoth = name => {
    const field = fields.get(name);
    return field && field.left.every(byte => byte === 0) && field.right.every(byte => byte === 0);
  };
  const scsp = 'Yamaha YMF292-F SCSP/:scsp/';
  const unusedScspDma = ['9', 'A', 'B'].every(index => zeroInBoth(`${scsp}${index}/m_udata.data[i]`));
  const ignoredDifferences = [];
  const differences = [];
  let excludedBytes = 0;
  for (const [name, field] of fields) {
    let reason;
    if (name.startsWith('timer/') && name.endsWith('/m_index') &&
        zeroInBoth(name.slice(0, -'m_index'.length) + 'm_enabled')) {
      reason = 'Uninitialized sort index of a disabled timer';
    } else if (unusedScspDma && new RegExp('^' + scsp + '0/m_dma\\.(dmea|drga|dtlg|dgate|ddir)$').test(name)) {
      reason = 'Uninitialized SCSP DMA storage while all three DMA registers are zero';
    }
    const changed = !field.left.equals(field.right);
    if (reason) {
      excludedBytes += field.length;
      if (changed) ignoredDifferences.push({ name, reason, reference: field.left.toString('hex'), candidate: field.right.toString('hex') });
      field.left.fill(0);
      field.right.fill(0);
    } else if (changed) differences.push({ name, offset: field.offset, length: field.length });
  }
  const hash = data => createHash('sha256').update(data).digest('hex');
  return { equal: differences.length === 0, serializedBytes: left.length, excludedBytes,
    referenceHash: hash(left), candidateHash: hash(right), ignoredDifferences, differences };
}
module.exports = { compareSaveStates };
