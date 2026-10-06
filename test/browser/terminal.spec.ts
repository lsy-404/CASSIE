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

const slowWorld = async (page: import('@playwright/test').Page) => page.route('**/assets/world-*.wasm', async (route) => { await new Promise((resolve) => setTimeout(resolve, 3000)); await route.continue().catch(() => undefined); });

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`a pending step is a yellow single-row line whose dots grow every 100 ms with the spinner after them at ${size.width}px`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await slowWorld(page);
    await page.goto('/');
    const line = page.getByTestId('terminal-step').filter({ hasText: 'instantiate WORLD wasm module' }).locator('.terminal-entry__line');
    await expect(line.locator('.terminal-entry__marker')).toHaveText('[PEND]');
    await expect(line.locator('.terminal-entry__marker')).toHaveCSS('color', 'rgb(250, 204, 21)');
    await expect(line.locator('.terminal-entry__spinner')).toHaveText(/^[\\|/-]$/);
    const order = await line.evaluate((el) => [...el.children].map((child) => child.className.replace('terminal-entry__', '')));
    expect(order).toEqual(['marker', 'label', 'dots', 'spinner']);
    const lineHeight = await line.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    const samples: { t: number; dots: number }[] = [];
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const dots = (await line.locator('.terminal-entry__dots').textContent())!;
      expect(dots).toMatch(/^( \.)*$/);
      expect((await line.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
      const spinner = (await line.locator('.terminal-entry__spinner').boundingBox())!;
      const log = (await page.getByTestId('terminal-log').boundingBox())!;
      expect(spinner.x + spinner.width).toBeLessThanOrEqual(log.x + log.width);
      samples.push({ t: Date.now() - start, dots: dots.length / 2 });
      await page.waitForTimeout(40);
    }
    const last = samples.at(-1)!;
    if (size.width > 400) {
      expect(last.dots).toBeGreaterThanOrEqual(8);
      expect(last.dots).toBeLessThanOrEqual(19);
    }
    for (let i = 1; i < samples.length; i += 1) expect(samples[i].dots).toBeGreaterThanOrEqual(samples[i - 1].dots);
    await page.screenshot({ path: info.outputPath(`pending-${size.width}.png`) });
    await expect(page.getByTestId('terminal-status')).toHaveText('SYSTEM READY', { timeout: 30_000 });
    const lines = page.locator('.terminal-entry__line');
    const count = await lines.count();
    for (let i = 0; i < count; i += 1) {
      await expect(lines.nth(i).locator('.terminal-entry__marker')).toHaveText('[ OK ]');
      await expect(lines.nth(i).locator('.terminal-entry__marker')).toHaveCSS('color', 'rgb(74, 222, 128)');
      await expect(lines.nth(i).locator('.terminal-entry__spinner')).toHaveCount(0);
      expect((await lines.nth(i).boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
    }
  });
}

test('dots stop growing and stay as they were when a step finishes', async ({ page }) => {
  await slowWorld(page);
  await page.goto('/');
  const step = page.locator('[data-testid="terminal-step"][data-status="pending"]').first();
  await expect(step).toBeVisible();
  const id = await step.locator('.terminal-entry__label').textContent();
  const done = page.getByTestId('terminal-step').filter({ hasText: id! }).locator('[class*="marker"]', { hasText: '[ OK ]' });
  const dots = page.getByTestId('terminal-step').filter({ hasText: id! }).locator('.terminal-entry__dots');
  await expect(done).toBeVisible({ timeout: 30_000 });
  const frozen = await dots.textContent();
  await page.waitForTimeout(400);
  expect(await dots.textContent()).toBe(frozen);
});

const haltedBoot = async (page: import('@playwright/test').Page, failingStep: string) => {
  const log = page.getByTestId('terminal-log');
  const error = page.getByTestId('terminal-error');
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(log).toBeVisible();
  await expect(page.getByRole('heading', { name: 'C.A.S.S.I.E.+' })).toBeVisible();
  await expect(page.getByTestId('terminal-scanlines')).toBeVisible();
  await expect(page.getByTestId('terminal-caption')).toBeVisible();
  const failLine = page.locator('[data-testid="terminal-step"][data-status="fail"]');
  await expect(failLine).toHaveCount(1);
  await expect(failLine).toContainText('[FAIL]');
  await expect(failLine).toContainText(failingStep);
  await expect(failLine.locator('.terminal-entry__marker')).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(log.getByTestId('terminal-error')).toHaveCount(1);
  const order = await log.evaluate((el) => [...el.children].map((child) => child.getAttribute('data-testid') ?? child.className));
  expect(order.at(-1)).toBe('terminal-error');
  expect(order.slice(0, -1).every((item) => item === 'terminal-step' || item === 'terminal-entry__probe')).toBe(true);
  const lines = error.locator('div');
  const texts = await lines.allTextContents();
  expect(texts.every((text) => text.startsWith('[ERROR] '))).toBe(true);
  expect(texts[0]).toContain(failingStep);
  expect(texts.at(-1)).toBe('[ERROR] startup halted');
  await expect(error).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(page.getByTestId('terminal-status')).toHaveText('STARTUP HALTED');
  await expect(page.getByTestId('terminal-status')).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByText('could not load on this device')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await log.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  return { texts, detail: (await failLine.locator('.terminal-entry__detail').textContent()) ?? '' };
};

for (const api of ['Worker', 'WebAssembly'] as const) {
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`missing ${api} keeps the boot log, marks FAIL and appends ERROR lines at ${size.width}px`, async ({ page }, info) => {
      await page.setViewportSize(size);
      await page.addInitScript((name) => Object.defineProperty(globalThis, name, { configurable: true, value: undefined }), api);
      await page.goto('/');
      const { detail } = await haltedBoot(page, 'probe browser capabilities');
      expect(detail).toContain(`missing ${api}`);
      await page.waitForTimeout(1500);
      await expect(page.locator('textarea')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`halted-${api}-${size.width}.png`) });
    });
  }
}

test('a real failed WASM fetch halts the boot log in place', async ({ page }) => {
  await page.route('**/assets/world-*.wasm', (route) => route.abort());
  await page.goto('/');
  const { detail } = await haltedBoot(page, 'instantiate WORLD wasm module');
  expect(detail).not.toBe('');
});

const warnedBoot = async (page: import('@playwright/test').Page, reason: RegExp) => {
  const step = page.locator('[data-testid="terminal-step"]', { hasText: 'spawn phoneme worker' });
  await expect(step).toHaveAttribute('data-status', 'warn', { timeout: 30_000 });
  await expect(step).toContainText('[WARN]');
  await expect(step.locator('.terminal-entry__detail')).toHaveText(reason);
  await expect(step.locator('.terminal-entry__marker')).toHaveCSS('color', 'rgb(251, 146, 60)');
  await expect(page.locator('textarea')).toBeEnabled({ timeout: 30_000 });
};

const workerFailures = [
  { name: 'is missing', respond: { status: 404, contentType: 'text/plain', body: 'missing' }, expected: /phoneme\.worker-.*\.js answered HTTP 404 \(text\/plain/ },
  { name: 'has a syntax error', respond: { status: 200, contentType: 'text/javascript', body: 'export {' }, expected: /was fetched \(HTTP 200, text\/javascript\) but failed to load as a module script/ },
  { name: 'is served as HTML', respond: { status: 200, contentType: 'text/html', body: '<html></html>' }, expected: /was fetched \(HTTP 200, text\/html\) but failed to load as a module script/ },
];
for (const failure of workerFailures) {
  test(`a phoneme worker that ${failure.name} reports the HTTP cause`, async ({ page }) => {
    await page.route('**/assets/phoneme.worker-*.js', (route) => route.fulfill({ status: failure.respond.status, contentType: failure.respond.contentType, body: failure.respond.body }));
    await page.goto('/');
    await warnedBoot(page, failure.expected);
  });
}

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
  await warnedBoot(page, /returned an invalid result\. \(last stage: never started\)/);
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

test('reduced motion shows PEND with a static spinner and no growing dots', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/assets/world-*.wasm', async (route) => { await new Promise((resolve) => setTimeout(resolve, 2000)); await route.continue().catch(() => undefined); });
  await page.goto('/');
  const line = page.locator('[data-testid="terminal-step"][data-status="pending"] .terminal-entry__line').first();
  await expect(line.locator('.terminal-entry__marker')).toHaveText('[PEND]');
  await expect(line.locator('.terminal-entry__spinner')).toHaveText('-');
  await page.waitForTimeout(600);
  await expect(line.locator('.terminal-entry__dots')).toHaveText('');
});
