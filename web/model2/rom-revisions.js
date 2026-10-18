// Older Model 2 collections call the Japanese Virtual-On set "von.zip".
// Current MAME uses "von" for Export. Read only ZIP directory metadata to
// recognize the root program pair; the native core still audits actual bytes.
const virtualOnPrograms = {
  von: [['epr-18832.15', 0xb900c332], ['epr-18833.16', 0xc793c638]],
  vonj: [['epr-18664b.15', 0x27d0172c], ['epr-18665b.16', 0x2f0142ee]],
  vonu: [['epr-18828b.15', 0x6499cc59], ['epr-18829b.16', 0x0053b10f]],
  vonr: [['epr-18671.15', 0xfdc01c6b], ['epr-18672.16', 0x98961f34]],
};

export async function virtualOnRevision(file) {
  if (file.name.toLowerCase() !== 'von.zip' || file.size < 22) return null;
  const start = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(start).arrayBuffer());
  let end = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (tail.getUint32(offset, true) === 0x06054b50
      && offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) { end = offset; break; }
  }
  if (end < 0 || tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)) return null;
  const count = tail.getUint16(end + 10, true), length = tail.getUint32(end + 12, true);
  const position = tail.getUint32(end + 16, true);
  if (count === 0xffff || length > 1048576 || position + length > start + end) return null;
  const bytes = await file.slice(position, position + length).arrayBuffer();
  const directory = new DataView(bytes), entries = new Map(), decoder = new TextDecoder();
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > length || directory.getUint32(offset, true) !== 0x02014b50) return null;
    const names = directory.getUint16(offset + 28, true), extras = directory.getUint16(offset + 30, true);
    const comments = directory.getUint16(offset + 32, true), next = offset + 46 + names + extras + comments;
    if (next > length) return null;
    const name = decoder.decode(new Uint8Array(bytes, offset + 46, names)).toLowerCase();
    if (!name.includes('/') && !name.includes('\\') && directory.getUint32(offset + 24, true) === 0x80000) {
      entries.set(name, directory.getUint32(offset + 16, true));
    }
    offset = next;
  }
  const matches = Object.entries(virtualOnPrograms).filter(([, chips]) => chips.every(([name, crc]) => entries.get(name) === crc));
  if (matches.some(([id]) => id === 'von')) return 'von'; // Modern merged parent.
  return matches.length === 1 ? matches[0][0] : null;
}
