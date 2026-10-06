import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { waitForStudio } from './helpers';

function launchUrl(payload: unknown, format?: string) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `/?data=${data}${format ? `&export=${format}` : ''}`;
}

test('terminal checks real engines, hands off to the studio on its own and starts no announcement playback', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'C.A.S.S.I.E.+' })).toBeVisible();
  await expect(page.getByText('CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES')).toBeVisible();
  await expect(page.getByTestId('terminal-scanlines')).toHaveCSS('pointer-events', 'none');
  await expect(page.getByTestId('terminal-status')).toHaveText('SYSTEM READY', { timeout: 30_000 });
  await expect(page.getByTestId('terminal-status')).toHaveCSS('color', 'rgb(74, 222, 128)');
  await expect(page.locator('button')).toHaveCount(0);
  const steps = page.getByTestId('terminal-step');
  expect(await steps.count()).toBeGreaterThanOrEqual(12);
  await expect(page.locator('[data-testid="terminal-step"]:not([data-status="ok"])')).toHaveCount(0);
  await expect(steps.filter({ hasText: 'load ffmpeg wasm chunk 1/' })).toContainText('[ OK ]');
  await expect(steps.filter({ hasText: 'instantiate WORLD wasm module' })).toContainText('OK');
  await expect(steps.filter({ hasText: 'render self-test' })).toContainText('render OK');
  await page.screenshot({ path: info.outputPath('terminal.png'), fullPage: true });
  await waitForStudio(page);
  await expect(page.getByTestId('terminal-status')).toHaveCount(0);
  await expect(page.locator('.fluent-theme')).toHaveAttribute('data-fluent-theme', 'dark');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  expect(errors).toEqual([]);
});

test('wordmark draws the plus inline after the final dot and the caption shows the package version', async ({ page }) => {
  await page.route('**/assets/world-*.wasm', async (route) => { await new Promise((resolve) => setTimeout(resolve, 3000)); await route.continue().catch(() => undefined); });
  await page.goto('/');
  const wordmark = page.getByRole('heading', { name: 'C.A.S.S.I.E.+' });
  await expect(wordmark).toBeVisible();
  await expect(wordmark.locator('svg')).toHaveCount(1);
  expect((await wordmark.locator('svg').getAttribute('viewBox'))!.split(' ').map(Number)).toEqual([0, 0, 59, 13]);
  const plusCell = (x: number, y: number) => wordmark.locator(`svg path[d*="M${x} ${y}h1v1h-1z"]`);
  await expect(plusCell(3 + 48 + 2, 3 + 1)).toHaveCount(1);
  await expect(plusCell(3 + 48 + 2, 3 + 0)).toHaveCount(0);
  const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  await expect(page.getByTestId('terminal-caption')).toHaveAttribute('aria-label', `CASSIE+  V${version}  INDEPENDENT PROJECT`);
  const caption = await page.getByTestId('terminal-caption').boundingBox();
  const log = await page.getByTestId('terminal-log').boundingBox();
  expect(caption!.y).toBeGreaterThanOrEqual(log!.y + log!.height);
  expect(caption!.x + caption!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('a pending step grows its dotted leader with elapsed time and fills it when the step finishes', async ({ page }) => {
  await page.route('**/assets/world-*.wasm', async (route) => { await new Promise((resolve) => setTimeout(resolve, 3000)); await route.continue().catch(() => undefined); });
  await page.goto('/');
  const pending = page.locator('[data-testid="terminal-step"][data-status="pending"] .terminal-entry__leader');
  const length = async () => (await pending.first().textContent())!.length;
  await expect(pending.first()).toBeVisible();
  const first = await length();
  await expect.poll(length, { timeout: 5000 }).toBeGreaterThan(first + 5);
  expect(await length()).toBeLessThan(160);
  await expect(page.getByTestId('terminal-status')).toHaveText('SYSTEM READY', { timeout: 30_000 });
  const leaders = await page.locator('.terminal-entry__leader').allTextContents();
  expect(leaders.every((text) => text.length === 160)).toBe(true);
});

for (const api of ['Worker', 'WebAssembly'] as const) {
  test(`missing ${api} displays centered device failure and never reaches the studio`, async ({ page }) => {
    await page.addInitScript((name) => Object.defineProperty(globalThis, name, { configurable: true, value: undefined }), api);
    await page.goto('/');
    const error = page.getByTestId('terminal-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('CASSIE PLUS could not load on this device');
    await expect(error).toContainText('[FAIL]');
    await expect(error).toContainText('Chromium');
    await expect(page.locator('textarea')).toHaveCount(0);
    const box = await error.boundingBox();
    const viewport = page.viewportSize()!;
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(5);
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(80);
  });
}

test('a real failed WASM fetch blocks the terminal', async ({ page }) => {
  await page.route('**/assets/world-*.wasm', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('terminal-error')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('terminal-error')).toContainText('instantiate WORLD wasm module');
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('a phonemizer echo cannot pass the startup pronunciation check', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      private readonly phonemeProbe: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.phonemeProbe = String(url).includes('phoneme.worker');
      }
      override postMessage(message: unknown, transfer: Transferable[] = []) {
        if (this.phonemeProbe) queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { phones: { hello: 'hello' } } })));
        else super.postMessage(message, transfer);
      }
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('terminal-error')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('base64 URL preloads Unicode text, fine voice settings and locale after start', async ({ page }) => {
  await page.goto(launchUrl({
    text: 'Attention <voice loudness="-2.5" tension="0.27">all personnel</voice> / ə /',
    locale: 'en',
    options: { rate: 1.13, voice: { loudnessDb: -3.2, tension: 0.23, breathiness: 0.17 } },
  }));
  await waitForStudio(page);
  await expect(page.locator('textarea')).toHaveValue('Attention <voice loudness="-2.5" tension="0.27">all personnel</voice> / ə /');
  await expect(page.getByRole('button', { name: 'Live render' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /Loudness/ })).toHaveValue('-3.2');
  await expect(page.getByRole('slider', { name: /Tension/ })).toHaveValue('0.23');
  await expect(page.getByRole('slider', { name: 'Breathiness', exact: true })).toHaveValue('0.17');
  await expect(page.getByRole('slider', { name: /Speech rate/ })).toHaveValue('1.13');
});

test('URL direct export downloads the provided announcement once', async ({ page }, info) => {
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto(launchUrl({ text: '<start>Attention all personnel<end>', options: { voice: { loudnessDb: -6 } } }, 'wav'));
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await waitForStudio(page);
  const download = await pending;
  expect(download.suggestedFilename()).toBe('cassie-announcement.wav');
  const file = info.outputPath('url-announcement.wav');
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(44 + 48_000);
  await expect(page.locator('textarea')).toHaveValue('<start>Attention all personnel<end>');
  await page.locator('textarea').fill('cassie');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  expect(downloads).toHaveLength(1);
});

test('invalid URL payload reports an input error and does not download default content', async ({ page }) => {
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto('/?data=not-base64!&export=wav');
  await waitForStudio(page);
  await expect(page.getByTestId('url-state-error')).toBeVisible();
  expect(downloads).toEqual([]);
});

test('URL Opus export encodes and downloads directly after start', async ({ page }, info) => {
  await page.goto(launchUrl({ text: 'attention all personnel', locale: 'en' }, 'opus'));
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await waitForStudio(page);
  const download = await pending;
  expect(download.suggestedFilename()).toBe('cassie-announcement.opus');
  const file = info.outputPath('url-announcement.opus');
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.toString('ascii', 0, 4)).toBe('OggS');
  expect(bytes.includes(Buffer.from('OpusHead'))).toBe(true);
});

test('editing during a URL export cancels the old download and resumes live rendering', async ({ page }) => {
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  let release = () => undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/audio/attention-all-personnel.opus', async (route) => { await pending; await route.continue().catch(() => undefined); });
  try {
    await page.goto(launchUrl({ text: 'attention all personnel' }, 'wav'));
    await waitForStudio(page);
    await expect(page.getByRole('button', { name: '取消渲染', exact: true })).toBeVisible();
    await page.locator('textarea').fill('cassie');
    release();
    await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
    expect(downloads).toEqual([]);
    await expect(page.locator('textarea')).toHaveValue('cassie');
  } finally { release(); }
});

test('reduced motion keeps static scanlines and enters the studio without a beat', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('terminal-scanlines')).toBeVisible();
  await expect.poll(() => page.getByTestId('terminal-scanlines').evaluate((el) => getComputedStyle(el, '::after').display)).toBe('none');
  await waitForStudio(page);
});

test('reduced motion shows the full leader of a pending step immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/assets/world-*.wasm', async (route) => { await new Promise((resolve) => setTimeout(resolve, 2000)); await route.continue().catch(() => undefined); });
  await page.goto('/');
  const pending = page.locator('[data-testid="terminal-step"][data-status="pending"] .terminal-entry__leader').first();
  await expect(pending).toHaveText('.'.repeat(160));
  await expect(page.locator('[data-status="pending"] .terminal-entry__marker').first()).toHaveText('[ -  ]');
});
