import test from 'node:test';
import assert from 'node:assert/strict';
import { importVirtualOn } from '../web/model2/virtual-on-roms.js';

const manifest = { profiles: { vonu: { sha256: '' } }, soundRegions: {} };
const fs = { FS: { mkdirTree() {}, writeFile() { throw Error('Invalid input must not reach the filesystem'); } } };
function zip(name = '', packed = new Uint8Array(), declaredSize = packed.length) {
  const filename = new TextEncoder().encode(name);
  const local = name ? 30 + filename.length + packed.length : 0;
  const central = name ? 46 + filename.length : 0;
  const bytes = new Uint8Array(local + central + 22), view = new DataView(bytes.buffer);
  if (name) {
    view.setUint32(0, 0x04034b50, true); view.setUint16(26, filename.length, true);
    bytes.set(filename, 30); bytes.set(packed, 30 + filename.length);
    view.setUint32(local, 0x02014b50, true);
    view.setUint32(local+20, packed.length, true); view.setUint32(local+24, declaredSize, true);
    view.setUint16(local+28, filename.length, true); bytes.set(filename, local+46);
  }
  const end = local + central;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end+8, Number(!!name), true); view.setUint16(end+10, Number(!!name), true);
  view.setUint32(end+12, central, true); view.setUint32(end+16, local, true);
  return [{ name: 'vonu.zip', bytes: bytes.buffer }];
}
test('standalone ROM importer rejects unsupported revisions and malformed ZIPs', async () => {
  await assert.rejects(importVirtualOn(fs, 'von', [], manifest), /USA and Japan Revision B/);
  await assert.rejects(importVirtualOn(fs, 'vonu', [{ bytes: new ArrayBuffer(1) }], manifest), /ZIP directory/);
  await assert.rejects(importVirtualOn(fs, 'vonu', zip(), manifest), /Missing epr-18828b.15/);
});
test('stored ROM payload must match its declared size before interleaving', async () => {
  await assert.rejects(importVirtualOn(fs, 'vonu', zip('epr-18828b.15', new Uint8Array([1]), 0x80000), manifest), /Truncated stored ROM chip/);
});
