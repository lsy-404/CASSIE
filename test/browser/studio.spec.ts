import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { OggOpusDecoder } from 'ogg-opus-decoder';

test('renders genuine voice audio and exports WAV and Opus under deployed headers', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const remoteRequests: string[] = [];
  const appOrigin = new URL(String(info.project.use.baseURL)).origin;
  page.context().on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== appOrigin) remoteRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText('ENGINE READY', { exact: true })).toBeVisible();
  await page.locator('textarea').fill('attention all personnel');
  await page.getByRole('button', { name: /生成公告音频/ }).click();
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /试听成品/ }).click();
  await expect(page.getByRole('button', { name: /停止播放/ })).toBeVisible();
  await page.getByRole('button', { name: /停止播放/ }).click();
  const wavDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV' }).click();
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
  await page.getByRole('button', { name: '导出 Opus', exact: true }).click();
  await expect(page.getByRole('link', { name: '下载 Opus' })).toBeVisible({ timeout: 90_000 });
  const opusDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 Opus' }).click();
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
  await expect(page.getByRole('button', { name: /生成公告音频/ })).toBeDisabled();
  await page.route('**/audio/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.locator('textarea').fill('attention all personnel');
  await page.getByRole('button', { name: /生成公告音频/ }).click();
  await page.getByRole('button', { name: /取消任务/ }).click();
  await page.locator('textarea').fill('cassie');
  await page.getByRole('button', { name: /生成公告音频/ }).click();
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('voice search and mobile themes remain accessible without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('ENGINE READY', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索素材' }).fill('central-autonomic-service-system-for-internal-emergencies');
  await page.getByRole('button', { name: '将 central-autonomic-service-system-for-internal-emergencies 设为开始提示' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('searchbox', { name: '搜索素材' }).fill('containment');
  await expect(page.locator('.clip-info code', { hasText: /^containment$/ })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.fluent-theme')).toHaveAttribute('data-fluent-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
});

test('measured phonemes compose locally and the experimental English switch is opt-in', async ({ page }, info) => {
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  const origin = new URL(String(info.project.use.baseURL)).origin;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|csp/i.test(message.text())) errors.push(message.text());
  });
  page.context().on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) remoteRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText('ENGINE READY', { exact: true })).toBeVisible();
  await expect(page.locator('.phone-list .fluent-button')).toHaveCount(55);
  await expect(page.getByRole('switch', { name: '实验音素拼合' })).toHaveAttribute('aria-checked', 'false');
  const phonemeIndex = JSON.parse(await readFile(new URL('../../public/phonemes.json', import.meta.url), 'utf8')) as {
    phones: Record<string, { sourceDurationSeconds: number }[]>;
  };

  await page.locator('textarea').fill('/ a e: /');
  await expect(page.locator('.ipa-summary')).toBeVisible();
  const directPhones = ((await page.locator('.ipa-summary span').textContent()) ?? '').split(/\s+/).filter(Boolean);
  const directSourceDuration = directPhones.reduce((total, phone) => total + (phonemeIndex.phones[phone]?.[0]?.sourceDurationSeconds ?? 0), 0);
  await page.getByRole('button', { name: /生成公告音频/ }).click();
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible();
  const wavDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV' }).click();
  const wav = await wavDownload;
  const wavPath = info.outputPath('phonemes.wav');
  await wav.saveAs(wavPath);
  const bytes = await readFile(wavPath);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(44);
  const phonemeDuration = (bytes.length - 44) / 96_000;
  expect(phonemeDuration).toBeGreaterThan(0.15);
  expect(phonemeDuration).toBeLessThan(0.6);
  expect(directSourceDuration).toBeGreaterThan(phonemeDuration * 2);
  const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
  const rms = Math.sqrt(pcm.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / pcm.length);
  expect(rms).toBeGreaterThan(0.005);

  await page.getByRole('switch', { name: '实验音素拼合' }).click();
  await expect(page.getByRole('switch', { name: '实验音素拼合' })).toHaveAttribute('aria-checked', 'true');
  await page.locator('textarea').fill('robot');
  await expect(page.locator('.ipa-summary')).toBeVisible({ timeout: 30_000 });
  const robotPhones = ((await page.locator('.ipa-summary span').textContent()) ?? '').split(/\s+/).filter(Boolean);
  const robotSourceDuration = robotPhones.reduce((total, phone) => total + (phonemeIndex.phones[phone]?.[0]?.sourceDurationSeconds ?? 0), 0);
  await page.getByRole('button', { name: /生成公告音频/ }).click();
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout: 90_000 });
  const robotDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV' }).click();
  const robotWav = await robotDownload;
  const robotPath = info.outputPath('robot-phonemes.wav');
  await robotWav.saveAs(robotPath);
  const robotBytes = await readFile(robotPath);
  expect(robotBytes.toString('ascii', 0, 4)).toBe('RIFF');
  const robotDuration = (robotBytes.length - 44) / 96_000;
  expect(robotDuration).toBeGreaterThan(0.2);
  expect(robotDuration).toBeLessThan(1.2);
  expect(robotSourceDuration).toBeGreaterThan(robotDuration * 2);
  const robotPcm = new Int16Array(robotBytes.buffer.slice(robotBytes.byteOffset + 44, robotBytes.byteOffset + robotBytes.length));
  const robotRms = Math.sqrt(robotPcm.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / robotPcm.length);
  expect(robotRms).toBeGreaterThan(0.005);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
