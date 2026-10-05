import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { OggOpusDecoder } from 'ogg-opus-decoder';

test('renders genuine voice audio and exports WAV and Opus under deployed headers', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const remoteRequests: string[] = [];
  const appOrigin = new URL(String(info.project.use.baseURL)).origin;
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== appOrigin) remoteRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText('ENGINE READY', { exact: true })).toBeVisible();
  await page.locator('textarea').fill('attention all personnel');
  await page.getByRole('button', { name: /COMPOSE AUDIO/ }).click();
  await expect(page.getByText('RENDER COMPLETE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /PREVIEW/ }).click();
  await expect(page.getByRole('button', { name: /STOP PREVIEW/ })).toBeVisible();
  await page.getByRole('button', { name: /STOP PREVIEW/ }).click();
  const wavDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download WAV file' }).click();
  const wav = await wavDownload;
  const wavPath = info.outputPath('announcement.wav');
  await wav.saveAs(wavPath);
  const bytes = await readFile(wavPath);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.readUInt32LE(24)).toBe(48_000);
  expect(bytes.length).toBeGreaterThan(48_000);
  const wavDuration = (bytes.length - 44) / 96_000;
  const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
  const rms = Math.sqrt(pcm.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / pcm.length);
  expect(rms).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: 'OPUS', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download Opus file' })).toBeVisible({ timeout: 90_000 });
  const opusDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download Opus file' }).click();
  const opus = await opusDownload;
  const opusPath = info.outputPath('announcement.opus');
  await opus.saveAs(opusPath);
  const opusBytes = await readFile(opusPath);
  expect(opusBytes.toString('ascii', 0, 4)).toBe('OggS');
  expect(opusBytes.length).toBeLessThan(bytes.length / 4);
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const decoded = await decoder.decodeFile(new Uint8Array(opusBytes));
    expect(decoded.errors).toEqual([]);
    expect(decoded.channelData[0].length / decoded.sampleRate).toBeCloseTo(wavDuration, 1);
  } finally { decoder.free(); }
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
});

test('editing unknown and empty text keeps the composer usable, and cancellation allows another render', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('ENGINE READY', { exact: true })).toBeVisible();
  await page.locator('textarea').fill('zzyyxxunrecorded');
  await expect(page.getByText('No audio clip', { exact: false }).first()).toBeVisible();
  await page.locator('textarea').fill('');
  await expect(page.getByRole('button', { name: /COMPOSE AUDIO/ })).toBeDisabled();
  await page.route('**/audio/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.locator('textarea').fill('attention all personnel');
  await page.getByRole('button', { name: /COMPOSE AUDIO/ }).click();
  await page.getByRole('button', { name: /CANCEL RENDER/ }).click();
  await page.locator('textarea').fill('cassie');
  await page.getByRole('button', { name: /COMPOSE AUDIO/ }).click();
  await expect(page.getByText('RENDER COMPLETE', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('voice search and mobile themes remain accessible without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('ENGINE READY', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search voice clips' }).fill('containment');
  await expect(page.locator('.clip-name', { hasText: /^containment$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
});
