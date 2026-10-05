import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public', 'ffmpeg');
const source = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const chunkSize = 8 * 1024 * 1024;
await mkdir(target, { recursive: true });
for (const file of await readdir(target)) {
  if (/^ffmpeg-core\.wasm\.(?:gz\.)?\d{2}$/.test(file)) await unlink(path.join(target, file));
}
await copyFile(path.join(source, 'ffmpeg-core.js'), path.join(target, 'ffmpeg-core.js'));
const wasm = await readFile(path.join(source, 'ffmpeg-core.wasm'));
const compressed = gzipSync(wasm, { level: 9 });
const parts = [];
for (let offset = 0; offset < compressed.length; offset += chunkSize) {
  const data = compressed.subarray(offset, Math.min(offset + chunkSize, compressed.length));
  const file = `ffmpeg-core.wasm.gz.${parts.length.toString().padStart(2, '0')}`;
  await writeFile(path.join(target, file), data);
  parts.push({ file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(path.join(target, 'manifest.json'), JSON.stringify({
  version: '0.12.10', bytes: wasm.length, compression: 'gzip', compressedBytes: compressed.length,
  sha256: createHash('sha256').update(wasm).digest('hex'), parts,
}, null, 2) + '\n');
console.log(`Prepared FFmpeg WASM: ${parts.length} chunks, ${compressed.length} compressed bytes`);
