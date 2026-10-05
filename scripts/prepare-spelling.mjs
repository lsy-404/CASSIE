import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public', 'spelling');
await mkdir(target, { recursive: true });
for (const [language, packageName] of [['en', 'dictionary-en'], ['en-gb', 'dictionary-en-gb']]) {
  for (const extension of ['aff', 'dic']) {
    await copyFile(path.join(root, 'node_modules', packageName, `index.${extension}`), path.join(target, `${language}.${extension}`));
  }
}
