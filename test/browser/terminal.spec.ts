import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unlockTerminal } from './helpers';

function launchUrl(payload: unknown, format?: string) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `/?data=${data}${format ? `&export=${format}` : ''}`;
}

test('terminal checks real engines before unlock and starts no announcement playback', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('CASSIE TERMINAL', { exact: true })).toBeVisible();
  await expect(page.getByTestId('terminal-unlock')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('terminal.png'), fullPage: true });
  await unlockTerminal(page);
  await expect(page.getByTestId('terminal-unlock')).toHaveCount(0);
  await expect(page.locator('.fluent-theme')).toHaveAttribute('data-fluent-theme', 'dark');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  expect(errors).toEqual([]);
});

for (const api of ['Worker', 'WebAssembly'] as const) {
  test(`missing ${api} displays centered device failure and never unlocks`, async ({ page }) => {
    await page.addInitScript((name) => Object.defineProperty(globalThis, name, { configurable: true, value: undefined }), api);
    await page.goto('/');
    const error = page.getByTestId('terminal-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('CASSIE 无法在您的设备上加载');
    await expect(error).toContainText('Chromium');
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(page.getByTestId('terminal-unlock')).toHaveCount(0);
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
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('base64 URL preloads Unicode text, fine voice settings and locale after unlock', async ({ page }) => {
  await page.goto(launchUrl({
    text: 'Attention <voice loudness="-2.5" tension="0.27">all personnel</voice> / ə /',
    locale: 'en',
    options: { rate: 1.13, voice: { loudnessDb: -3.2, tension: 0.23, breathiness: 0.17 } },
  }));
  await unlockTerminal(page);
  await expect(page.locator('textarea')).toHaveValue('Attention <voice loudness="-2.5" tension="0.27">all personnel</voice> / ə /');
  await expect(page.getByRole('checkbox', { name: 'Live render' })).toBeVisible();
  await page.locator('.voice-processing summary').click();
  await expect(page.getByRole('slider', { name: /Loudness/ })).toHaveValue('-3.2');
  await expect(page.getByRole('slider', { name: /Tension/ })).toHaveValue('0.23');
  await expect(page.getByRole('slider', { name: 'Breathiness', exact: true })).toHaveValue('0.17');
  await expect(page.getByRole('slider', { name: /Speech rate/ })).toHaveValue('1.13');
});

test('URL direct export waits for unlock and downloads the provided announcement once', async ({ page }, info) => {
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.goto(launchUrl({ text: '<start>Attention all personnel<end>', options: { voice: { loudnessDb: -6 } } }, 'wav'));
  await expect(page.getByTestId('terminal-unlock')).toBeEnabled({ timeout: 30_000 });
  expect(downloads).toEqual([]);
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await unlockTerminal(page);
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
  await unlockTerminal(page);
  await expect(page.getByTestId('url-state-error')).toBeVisible();
  expect(downloads).toEqual([]);
});
