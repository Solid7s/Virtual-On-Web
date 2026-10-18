// Local-only ZIP import for the two compiled Virtual-On programs. Whole-region
// hashes below come from the build manifest after individual MAME ROM audits.
const programs = {
  vonu: ['epr-18828b.15', 'epr-18829b.16'],
  vonj: ['epr-18664b.15', 'epr-18665b.16'],
};

function directory(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); --p)
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('Unsupported ROM ZIP directory.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
  let p = view.getUint32(end + 16, true);
  if (count === 65535 || size > 1048576 || p + size > end) throw Error('Unsupported ROM ZIP size.');
  const limit = p + size, entries = [], decoder = new TextDecoder();
  for (let i = 0; i < count; ++i) {
    if (p + 46 > limit || view.getUint32(p, true) !== 0x02014b50) throw Error('Damaged ROM ZIP directory.');
    const length = view.getUint16(p + 28, true);
    const next = p + 46 + length + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    if (next > limit) throw Error('Damaged ROM ZIP filename.');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + length)).replaceAll('\\', '/').toLowerCase();
    entries.push({ name, base: name.split('/').at(-1), buffer, method: view.getUint16(p + 10, true),
      flags: view.getUint16(p + 8, true), packed: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true), offset: view.getUint32(p + 42, true) });
    p = next;
  }
  return entries;
}
async function extract(entry, expected) {
  if (entry.size !== expected || entry.flags & 1 || ![0, 8].includes(entry.method)) throw Error(`Unsupported ROM chip: ${entry.base}`);
  const view = new DataView(entry.buffer), p = entry.offset;
  if (p + 30 > view.byteLength || view.getUint32(p, true) !== 0x04034b50) throw Error('Damaged ROM ZIP entry.');
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  if (start + entry.packed > view.byteLength) throw Error('Truncated ROM ZIP entry.');
  const packed = new Uint8Array(entry.buffer, start, entry.packed);
  if (!entry.method) {
    if (entry.packed !== expected) throw Error('Truncated stored ROM chip.');
    return packed;
  }
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), result = new Uint8Array(expected);
  let used = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (used + value.length > expected) { await reader.cancel(); throw Error('Oversized ROM chip.'); }
    result.set(value, used); used += value.length;
  }
  if (used !== expected) throw Error('Truncated ROM chip.');
  return result;
}
async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export async function importVirtualOn(Module, game, archives, manifest, progress = () => {}) {
  if (!programs[game]) throw Error('This standalone build supports Virtual-On USA and Japan Revision B.');
  const entries = archives.flatMap(a => directory(a.bytes));
  const regions = [
    [game, 0x200000, 0, 0x80000, [...programs[game], 'epr-18666.13', 'epr-18667.14'], 0x100000, manifest.profiles[game].sha256],
    ['main-data', 0x2000000, 0, 0x400000, ['mpr-18648.11', 'mpr-18649.12', 'mpr-18650.9', 'mpr-18651.10'], 0x800000, manifest.dataSha256],
    ['copro-data', 0x800000, 0, 0x200000, ['mpr-18662.29', 'mpr-18663.30'], 0x400000, manifest.coproDataSha256],
    ['polygons', 0x1000000, 255, 0x400000, ['mpr-18654.17', 'mpr-18655.21', 'mpr-18656.18', 'mpr-18657.22'], 0x800000, manifest.polygonsSha256],
    ['textures', 0x1000000, 255, 0x200000, ['mpr-18660.27', 'mpr-18658.25', 'mpr-18661.28', 'mpr-18659.26'], 0x800000, manifest.texturesSha256],
    ['sound-program', 0x80000, 0, 0x80000, ['epr-18670.31'], 0, manifest.soundRegions['sound-program']],
    ['samples', 0x800000, 0, 0x400000, ['mpr-18652.32', 'mpr-18653.34'], 0, manifest.soundRegions.samples],
  ];
  Module.FS.mkdirTree('/virtual-on');
  for (const [name, size, fill, chipSize, chips, pairStride, expectedHash] of regions) {
    progress(`Checking ${name} ROMs…`);
    const region = new Uint8Array(size).fill(fill);
    for (const [i, chip] of chips.entries()) {
      const entry = entries.find(e => e.name === `${game}/${chip}`) || entries.find(e => e.base === chip);
      if (!entry) throw Error(`Missing ${chip}. Select the parent von.zip archive and, for a split set, its ${game}.zip together.`);
      const bytes = await extract(entry, chipSize), offset = Math.floor(i / 2) * pairStride + (i % 2) * 2;
      if (!pairStride) {
        for (let j = 0; j < bytes.length; j += 2) {
          region[i*chipSize + j] = bytes[j+1]; region[i*chipSize + j+1] = bytes[j];
        }
        continue;
      }
      for (let j = 0; j < bytes.length; j += 2) {
        region[offset + j*2] = bytes[j]; region[offset + j*2 + 1] = bytes[j + 1];
      }
    }
    if (await hash(region) !== expectedHash) throw Error(`ROM integrity check failed for ${name}. Use the supported Revision B set.`);
    Module.FS.writeFile(`/virtual-on/${name}.bin`, region);
  }
}
