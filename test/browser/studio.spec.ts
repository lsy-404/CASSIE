import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { OggOpusDecoder } from 'ogg-opus-decoder';

async function waitForReady(page: import('@playwright/test').Page, timeout = 90000) {
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout });
}

async function saveWav(page: import('@playwright/test').Page, path: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV' }).click();
  const item = await download;
  await item.saveAs(path);
  return readFile(path);
}

test('live render creates local WAV, native player tracks words and gaps, and Opus export remains valid', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const remoteRequests: string[] = [];
  const appOrigin = new URL(String(info.project.use.baseURL)).origin;
  page.context().on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== appOrigin) remoteRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('checkbox', { name: '实时渲染' })).toBeChecked();
  await expect(page.getByRole('heading', { name: '素材目录' })).toHaveCount(0);
  const trackStyle = await page.locator('input[type="range"]').first().evaluate((input) => ({
    position: (input as HTMLInputElement).style.getPropertyValue('--fluent-slider-position'),
    backgroundColor: getComputedStyle(input).backgroundColor,
    trackRule: Array.from(document.styleSheets).flatMap((sheet) => {
      try { return Array.from(sheet.cssRules); } catch { return []; }
    }).find((rule) => rule.cssText.includes('.fluent-slider__input::-webkit-slider-runnable-track'))?.cssText ?? '',
  }));
  expect(trackStyle.position).toMatch(/%$/);
  expect(trackStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(trackStyle.trackRule).toContain('var(--fluent-accent)');
  expect(trackStyle.trackRule).toContain('var(--fluent-border)');
  await expect(page.getByText('ENGINE READY', { exact: true })).toHaveCount(0);
  await page.locator('textarea').fill('attention lockdown personnel');
  await waitForReady(page);
  const audio = page.locator('audio');
  await expect(audio).toBeVisible();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  expect(await page.locator('.token-recorded, .token-synthesized').count()).toBeGreaterThanOrEqual(3);
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = 0.05;
    element.dispatchEvent(new Event('seeking'));
  });
  await expect(page.locator('.annotated-editor .active').first()).toBeVisible();
  await expect(page.locator('.annotated-editor .active').first()).toContainText('attention');
  const hasActiveGap = await audio.evaluate(async (element: HTMLAudioElement) => {
    await new Promise<void>((resolve) => {
      if (element.readyState >= 1) resolve();
      else element.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    const duration = element.duration;
    for (let time = 0.01; time < duration; time += 0.025) {
      element.currentTime = time;
      element.dispatchEvent(new Event('seeking'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      if (document.querySelector('.annotated-editor .active')?.classList.contains('token-gap')) return true;
    }
    return false;
  });
  expect(hasActiveGap).toBe(true);
  const wavPath = info.outputPath('announcement.wav');
  const bytes = await saveWav(page, wavPath);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.readUInt32LE(24)).toBe(48_000);
  expect(bytes.length).toBeGreaterThan(48_000);
  const wavDuration = (bytes.length - 44) / 96_000;
  const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
  const rms = Math.sqrt(pcm.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / pcm.length);
  expect(rms).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: '导出 Opus', exact: true }).click();
  await expect(page.getByRole('link', { name: '下载 Opus' })).toBeVisible({ timeout: 90000 });
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

test('manual rendering can be cancelled and restarted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('.live-controls .fluent-checkbox__box').click();
  await expect(page.getByRole('checkbox', { name: '实时渲染' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '生成公告音频' })).toBeVisible();
  await page.locator('textarea').fill('zzyyxxunrecorded');
  await page.route('**/audio/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.getByRole('button', { name: '生成公告音频' }).click();
  await page.getByRole('button', { name: '取消任务' }).click();
  await expect(page.getByText('渲染已取消')).toBeVisible();
  await page.unroute('**/audio/**');
  await page.locator('textarea').fill('attention all personnel');
  await page.getByRole('button', { name: '生成公告音频' }).click();
  await waitForReady(page);
  expect(errors).toEqual([]);
});

test('command authoring and editor remain compact at mobile widths with system Fluent theme', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '停顿', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '卡顿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停顿', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue(/\/pause:0\.5/);
  await expect(page.getByRole('heading', { name: '素材目录' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.fluent-theme')).toHaveAttribute('data-fluent-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
});

test('direct phonemes and unknown English words synthesize locally by default', async ({ page }, info) => {
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
  await page.locator('textarea').fill('/ a e: /');
  await expect(page.locator('.analysis-details summary')).toBeVisible();
  await waitForReady(page, 90000);
  await expect(page.locator('.annotated-editor .token-error')).toHaveText('/ a e: /');
  await expect(page.getByText(/was stretched from/).last()).toBeVisible();
  const phonemePath = info.outputPath('phonemes.wav');
  const bytes = await saveWav(page, phonemePath);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect((bytes.length - 44) / 96_000).toBeGreaterThan(0.15);
  expect((bytes.length - 44) / 96_000).toBeLessThan(0.6);

  await page.locator('textarea').fill('robot');
  await expect(page.locator('.analysis-details summary')).toBeVisible({ timeout: 30000 });
  await waitForReady(page, 90000);
  const robotPath = info.outputPath('robot-phonemes.wav');
  const robotBytes = await saveWav(page, robotPath);
  expect(robotBytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect((robotBytes.length - 44) / 96_000).toBeGreaterThan(0.2);
  expect((robotBytes.length - 44) / 96_000).toBeLessThan(1.2);

  await page.locator('textarea').fill('This is a unsupport worksheet test. I');
  await expect(page.locator('.spell-missing')).toContainText('unsupport', { timeout: 30000 });
  const synthesizedWords = await page.locator('.annotated-editor .token-synthesized').allTextContents();
  expect(synthesizedWords).toContain('a');
  expect(synthesizedWords).toContain('I');
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: 'worksheet' })).toBeVisible();
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: 'worksheet' })).not.toHaveClass(/spell-missing/);
  await expect(page.locator('.spell-missing').first()).toHaveCSS('text-decoration-line', 'underline');
  await expect(page.locator('.spell-missing').first()).toHaveCSS('text-decoration-style', 'wavy');
  await expect(page.locator('.spell-missing').first()).toHaveCSS('text-decoration-color', 'rgb(196, 43, 28)');
  await waitForReady(page, 90000);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
