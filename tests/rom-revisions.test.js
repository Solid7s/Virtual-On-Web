import { test } from 'node:test';
import assert from 'node:assert/strict';
import { virtualOnRevision } from '../web/model2/rom-revisions.js';

// ZIP metadata fixtures; ROM contents are neither needed nor included.
function zip(chips, name = 'von.zip') {
  const directory = Buffer.concat(chips.map(([name, crc]) => {
    const filename = Buffer.from(name), header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(0x80000, 24);
    header.writeUInt16LE(filename.length, 28);
    return Buffer.concat([header, filename]);
  }));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(chips.length, 8); end.writeUInt16LE(chips.length, 10);
  end.writeUInt32LE(directory.length, 12);
  return new File([directory, end], name);
}
const japan = [['epr-18664b.15', 0x27d0172c], ['epr-18665b.16', 0x2f0142ee]];
const exportSet = [['epr-18832.15', 0xb900c332], ['epr-18833.16', 0xc793c638]];
test('legacy von.zip selects Japan by its root program pair, while modern merged parents stay Export', async () => {
  assert.equal(await virtualOnRevision(zip(japan)), 'vonj');
  assert.equal(await virtualOnRevision(zip([...exportSet, ...japan])), 'von');
  assert.equal(await virtualOnRevision(zip(japan.map(([name, crc]) => [`vonj/${name}`, crc]))), null);
  assert.equal(await virtualOnRevision(zip(japan, 'VON.ZIP')), 'vonj');
  assert.equal(await virtualOnRevision(zip(japan, 'vonu.zip')), null);
});
test('incomplete, mismatched or malformed ZIP metadata never guesses a revision', async () => {
  assert.equal(await virtualOnRevision(zip([japan[0]])), null);
  assert.equal(await virtualOnRevision(zip([japan[0], [japan[1][0], 0]])), null);
  assert.equal(await virtualOnRevision(new File(['not a zip'], 'von.zip')), null);
  const valid = await zip(japan).arrayBuffer();
  assert.equal(await virtualOnRevision(new File([valid.slice(0, -5)], 'von.zip')), null);
  const invalid = new DataView(valid);
  invalid.setUint32(valid.byteLength - 10, 1048577, true);
  assert.equal(await virtualOnRevision(new File([valid], 'von.zip')), null);
});
