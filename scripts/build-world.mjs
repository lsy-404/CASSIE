import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'audio', 'world');
const vendor = path.join(source, 'vendor');
const build = path.join(root, 'work', 'world-wasm-build');
const stagedOutput = path.join(build, 'artifacts');
const output = path.join(source, 'runtime');
const expectedWorldRevision = 'd625e7608ca23a870018f01e7c562ac683d9847f';
const expectedEmscripten = '6.0.10';
const emsdk = process.env.EMSDK;
const emscriptenBin = emsdk ? path.join(emsdk, 'upstream', 'emscripten') : undefined;
const pathEntries = process.env.PATH?.split(path.delimiter) ?? [];
const env = {
  ...process.env,
  PATH: [...(emscriptenBin ? [emscriptenBin] : []), ...pathEntries].join(path.delimiter),
};

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
}

const emccVersion = spawnSync('emcc', ['-v'], {
  cwd: root,
  env,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const emccOutput = `${emccVersion.stdout ?? ''}\n${emccVersion.stderr ?? ''}`;
if (emccVersion.status !== 0 || !emccOutput.includes(` ${expectedEmscripten} `)) {
  throw new Error(`Expected Emscripten ${expectedEmscripten}; run the pinned emsdk environment first.`);
}

run('git', ['submodule', 'update', '--init', '--depth', '1', '--', 'src/audio/world/vendor']);
const worldRevision = execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (worldRevision !== expectedWorldRevision) {
  throw new Error(`Unexpected WORLD revision ${worldRevision}; expected ${expectedWorldRevision}.`);
}

await mkdir(build, { recursive: true });
await rm(stagedOutput, { recursive: true, force: true });
await mkdir(stagedOutput, { recursive: true });

const emsdkToolchain = emsdk
  ? path.join(emsdk, 'upstream', 'emscripten', 'cmake', 'Modules', 'Platform', 'Emscripten.cmake')
  : undefined;
if (!emsdkToolchain) throw new Error('Set EMSDK to the activated Emscripten 6.0.10 directory.');

run('cmake', [
  '-S', source,
  '-B', build,
  '-G', 'Ninja',
  `-DCMAKE_TOOLCHAIN_FILE=${emsdkToolchain}`,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${stagedOutput}`,
  '-DWORLD_BUILD_EXAMPLES=OFF',
  '-DWORLD_BUILD_TESTS=OFF',
]);
run('cmake', ['--build', build, '--target', 'cassie_world', '--config', 'Release']);

const modulePath = path.join(stagedOutput, 'world.mjs');
const wasmPath = path.join(stagedOutput, 'world.wasm');
if ((await stat(modulePath)).size === 0 || (await stat(wasmPath)).size === 0) {
  throw new Error('WORLD build produced an empty module artifact.');
}
await mkdir(output, { recursive: true });
await mkdir(path.join(root, 'public', 'licenses'), { recursive: true });
const stagedModule = path.join(output, 'world.mjs.new');
const stagedWasm = path.join(output, 'world.wasm.new');
const stagedLicense = path.join(root, 'public', 'licenses', 'world.txt.new');
await copyFile(modulePath, stagedModule);
const stagedModuleSource = (await readFile(stagedModule, 'utf8'))
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+$/gm, '')
  .trimEnd();
await writeFile(stagedModule, `${stagedModuleSource}\n`);
await copyFile(wasmPath, stagedWasm);
await copyFile(path.join(vendor, 'LICENSE.txt'), stagedLicense);
await rename(stagedModule, path.join(output, 'world.mjs'));
await rename(stagedWasm, path.join(output, 'world.wasm'));
await rename(stagedLicense, path.join(root, 'public', 'licenses', 'world.txt'));
