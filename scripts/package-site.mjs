import { readFile, writeFile, mkdir, rm, lstat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '_site');
const files = JSON.parse(await readFile(path.join(root, 'site-files.json'), 'utf8'));
const engine = 'build/v3-standalone/player-wasm/';
const manifest = JSON.parse(await readFile(path.join(root, engine, 'build.json'), 'utf8'));
if (manifest.mameRuntimeLinked || manifest.interpreterLinked) throw Error('Unexpected engine type');
for (const name of ['virtual-on-standalone.cjs', 'virtual-on-standalone.wasm']) {
  const hash = createHash('sha256').update(await readFile(path.join(root, engine, name))).digest('hex');
  if (hash !== manifest.artifacts[name]) throw Error(`Engine hash mismatch: ${name}`);
}
for (const name of files) {
  if (typeof name !== 'string' || path.isAbsolute(name) || name.split('/').includes('..')
    || /(^|\/)(roms|vendor|tools|node_modules|\.git)(\/|$)|\.(zip|7z|bin|chd|o|log)$/i.test(name)) {
    throw Error(`Disallowed publication path: ${name}`);
  }
  let part = root;
  for (const segment of name.split('/')) {
    part = path.join(part, segment);
    if ((await lstat(part)).isSymbolicLink()) throw Error(`Symlink in publication path: ${name}`);
  }
  if (!(await lstat(part)).isFile()) throw Error(`Expected a file: ${name}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of files) {
  const target = path.join(output, name);
  await mkdir(path.dirname(target), { recursive: true });
  if (name === engine + 'build.json') {
    const { linkCommand, ...publicManifest } = manifest;
    await writeFile(target, JSON.stringify(publicManifest, null, 2) + '\n');
  } else await copyFile(path.join(root, name), target);
}
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Packaged ${files.length} files for GitHub Pages; engine hashes verified.`);
