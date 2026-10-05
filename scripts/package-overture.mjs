import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.argv[2] || 'work/release');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const tag = process.env.RELEASE_TAG || `v${pkg.version}`;
if (tag !== `v${pkg.version}`) throw new Error('Release tag must match package.json version.');
await mkdir(path.join(root, 'work'), { recursive: true });
const stage = await mkdtemp(path.join(root, 'work', 'overture-'));
await cp(path.join(root, 'dist'), path.join(stage, 'assets'), { recursive: true });
await mkdir(path.join(stage, 'worker'));
await copyFile(path.join(root, 'recipe', 'worker.js'), path.join(stage, 'worker', 'index.js'));
await copyFile(path.join(root, 'recipe', 'recipe.js'), path.join(stage, 'recipe.js'));

async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}

const files = await walk(path.join(stage, 'assets'));
const manifest = {};
let assetBytes = 0;
for (const file of files) {
  if (file === '_headers' || file === '_redirects') continue;
  const bytes = await readFile(path.join(stage, 'assets', file));
  assetBytes += bytes.length;
  const extension = path.extname(file).slice(1);
  const hash = createHash('sha256').update(bytes.toString('base64') + extension).digest('hex').slice(0, 32);
  manifest[`/${file}`] = { hash, size: bytes.length };
}
if (assetBytes > 64 * 1024 * 1024) throw new Error(`Overture static assets exceed 64 MiB: ${assetBytes}`);
await writeFile(path.join(stage, 'assets-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await mkdir(output, { recursive: true });
const artifact = path.join(output, 'overture.tar.gz');
execFileSync('tar', ['-czf', artifact, '-C', stage, 'recipe.js', 'worker', 'assets-manifest.json', 'assets']);
const entries = execFileSync('tar', ['-tf', artifact], { encoding: 'utf8' }).trim().split(/\r?\n/);
if (entries.length > 20_000) throw new Error(`Overture tar archive exceeds 20,000 entries: ${entries.length}`);
const archive = await readFile(artifact);
if (archive.length > 24 * 1024 * 1024) throw new Error('Overture artifact exceeds 24 MiB.');
const sha256 = createHash('sha256').update(archive).digest('hex');
const license = await readFile(path.join(root, 'LICENSE'), 'utf8');
const recipe = {
  schema: 2,
  id: 'cassie', name: 'CASSIE',
  summary: { en: 'Browser CASSIE announcement studio with Fluent UI and WebAssembly audio.', 'zh-CN': '基于 Fluent UI 与 WebAssembly 音频处理的浏览器 CASSIE 广播工作室。' },
  homepage: 'https://github.com/lsy-404/CASSIE',
  version: pkg.version, tag, buildTime: new Date().toISOString(),
  package: { artifact: 'overture.tar.gz', sha256, bytes: archive.length },
  license: { id: 'AGPL-3.0-only', text: license },
  terms: {
    required: true,
    texts: {
      '*': 'Program code is AGPL-3.0-only. SCP: Secret Laboratory voice recordings and Opus adaptations are CC BY-SA 3.0, credited to Northwood Studios and contributors. Third-party software retains its licenses. This package serves static assets only and stores no account credential in the deployed app.',
      'zh-CN': '程序代码采用 AGPL-3.0-only。SCP: Secret Laboratory 的录音及 Opus 改编采用 CC BY-SA 3.0，并保留 Northwood Studios 与贡献者署名。第三方软件保留原许可。本包仅提供静态资源，部署后的应用不保存账户凭证。',
    },
  },
  authModes: ['oauth', 'auto'],
  permissions: [
    { key: 'scripts', requirement: 'required', oauthScopes: ['workers-scripts.read', 'workers-scripts.write', 'workers-scripts.bind'], scope: 'account', level: 'write', label: { en: 'Workers Scripts', 'zh-CN': 'Workers 脚本' }, scenario: { en: 'Upload static assets and activate the deployment', 'zh-CN': '上传静态资源并启用部署' } },
    { key: 'domains', requirement: 'optional', oauthScopes: ['workers-routes.read', 'workers-routes.write', 'zone.read'], scope: 'account', level: 'write', label: { en: 'Custom domain', 'zh-CN': '自定义域名' }, scenario: { en: 'Bind a custom domain when selected', 'zh-CN': '选用自定义域名时进行绑定' } },
  ],
  resources: [],
  worker: { defaultName: 'cassie', module: 'worker/index.js', assetsManifest: 'assets-manifest.json', assetsDir: 'assets', assetHeaders: 'assets/_headers', assetsBinding: 'ASSETS', compatibilityDate: '2026-10-05', compatibilityFlags: [] },
  capabilities: ['assets', 'worker', 'domains'],
  steps: [
    { id: 'assets', label: { en: 'Upload static assets', 'zh-CN': '上传静态资源' }, weight: 4 },
    { id: 'worker', label: { en: 'Activate Worker', 'zh-CN': '启用 Worker' } },
    { id: 'domain', label: { en: 'Bind custom domain', 'zh-CN': '绑定自定义域名' }, optional: true },
  ],
  health: { path: '/bank.json' },
  done: { links: [{ label: { en: 'Open CASSIE', 'zh-CN': '打开 CASSIE' }, href: '${url}' }] },
};
await writeFile(path.join(output, 'overture.json'), JSON.stringify(recipe, null, 2) + '\n');
await writeFile(path.join(output, 'SHA256SUMS'), `${sha256}  overture.tar.gz\n`);
console.log(JSON.stringify({ assetBytes, archiveBytes: archive.length, entries: entries.length, sha256, output }));
