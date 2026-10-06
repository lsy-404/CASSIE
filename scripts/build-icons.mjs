import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const svg = await readFile(`${publicDir}favicon.svg`, 'utf8');
const BACKGROUND = '#11140f';
const ICO_SIZES = [16, 32, 48];

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, opaque) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:${opaque ? BACKGROUND : 'transparent'}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ type: 'png', omitBackground: !opaque, clip: { x: 0, y: 0, width: size, height: size } });
}

const frames = [];
for (const size of ICO_SIZES) frames.push({ size, png: await render(size, false) });
const apple = await render(180, true);
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = 6 + frames.length * 16;
const entries = frames.map(({ size, png }) => {
  const entry = Buffer.alloc(16);
  entry[0] = size;
  entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});

await writeFile(`${publicDir}favicon.ico`, Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]));
await writeFile(`${publicDir}apple-touch-icon.png`, apple);
