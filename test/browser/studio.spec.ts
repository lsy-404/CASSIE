import { openPanel, openSideView, openStudio, wavButton } from './helpers';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { OggOpusDecoder } from 'ogg-opus-decoder';

test('default recruitment announcement exposes complete editable markup examples', async ({ page }) => {
  await openStudio(page);
  const editor = page.locator('textarea');
  const value = await editor.inputValue();
  expect(value).toContain('Secure. Contain. Protect.');
  expect(value).toContain('Become Class-D.');
  for (const sample of [
    '<start>', '<end>', '<pause seconds="0.5"/>',
    '<pitch value="1.2">', '</pitch>', '<volume value="0.7">', '</volume>',
    '<stutter repeats="2">', '</stutter>', '<rate value="1.1">', '</rate>',
    '<fit seconds="2.5">', '</fit>', '</voice>',
  ]) expect(value).toContain(sample);
  const typography = await page.locator('.annotated-editor').evaluate((container) => {
    const field = getComputedStyle(container.querySelector('textarea')!);
    const overlay = getComputedStyle(container.querySelector('.highlight-layer')!);
    return { field: [field.fontFamily, field.fontSize, field.lineHeight], overlay: [overlay.fontFamily, overlay.fontSize, overlay.lineHeight] };
  });
  expect(typography.overlay).toEqual(typography.field);
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('data-complete', 'true', { timeout: 90_000 });
  await expect(page.locator('.announcement-player')).toBeVisible();
  await expect(page.locator('.annotated-editor .token-error')).toHaveCount(0);
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: /^(Become|Class-D|legend)$/ })).toHaveCount(4);
});

test('voice post-processing controls default neutral and the ribbon has no voice scope button', async ({ page }) => {
  await openStudio(page);
  const pitchShift = page.getByRole('slider', { name: '音调偏移（半音）' });
  const breathiness = page.getByRole('slider', { name: '气声' });
  const formant = page.getByRole('slider', { name: '共振峰偏移（半音）' });
  for (const slider of [pitchShift, breathiness, formant]) await expect(slider).toHaveValue('0');
  await expect(pitchShift).toHaveAttribute('min', '-12');
  await expect(pitchShift).toHaveAttribute('max', '12');
  await expect(pitchShift).toHaveAttribute('step', '0.1');
  await expect(breathiness).toHaveAttribute('min', '0');
  await expect(breathiness).toHaveAttribute('max', '1');
  await expect(breathiness).toHaveAttribute('step', '0.01');
  await expect(formant).toHaveAttribute('min', '-6');
  await expect(formant).toHaveAttribute('max', '6');
  await expect(formant).toHaveAttribute('step', '0.1');
  await expect(page.locator('[data-section="processing"]')).toContainText('WORLD DSP');
  await expect(page.getByRole('button', { name: '语音作用范围', exact: true })).toHaveCount(0);
});

test('deferred cursor restoration does not override newer editor input', async ({ page }) => {
  await openStudio(page);
  await page.locator('textarea').fill('metrics');
  await page.evaluate(() => {
    const button = document.querySelector('[data-command="marker.clip"]');
    const field = document.querySelector<HTMLTextAreaElement>('.annotated-editor textarea');
    if (!button || !field) throw new Error('Editor controls were not ready');
    field.setSelectionRange(2, 2);
    button.click();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(field, 'subsequent edit');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  const field = page.locator('textarea');
  await expect(field).toHaveValue('subsequent edit');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe('subsequent edit'.length);
});

async function waitForReady(page: import('@playwright/test').Page, timeout = 90000) {
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('data-complete', 'true', { timeout });
}

async function saveWav(page: import('@playwright/test').Page, path: string) {
  const download = page.waitForEvent('download');
  await wavButton(page).click();
  const item = await download;
  await item.saveAs(path);
  return readFile(path);
}

test('live render creates local WAV, custom player tracks words and gaps, and Opus export remains valid', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const remoteRequests: string[] = [];
  const appOrigin = new URL(String(info.project.use.baseURL)).origin;
  page.context().on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== appOrigin) remoteRequests.push(request.url());
  });
  await openStudio(page);
  await expect(page.getByRole('button', { name: '实时渲染' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '素材目录' })).toHaveCount(0);
  const trackStyle = await page.locator('input[type="range"]').first().evaluate((input) => ({
    position: (input as HTMLInputElement).style.getPropertyValue('--fluent-slider-position'),
    backgroundColor: getComputedStyle(input).backgroundColor,
    trackRule: Array.from(document.styleSheets).flatMap((sheet) => {
      try { return Array.from(sheet.cssRules); } catch { return []; }
    }).find((rule) => (rule as CSSStyleRule).selectorText === '.fluent-slider__input::-webkit-slider-runnable-track')?.cssText ?? '',
  }));
  expect(trackStyle.position).toMatch(/%$/);
  expect(trackStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(trackStyle.trackRule).toContain('var(--fluent-accent)');
  expect(trackStyle.trackRule).toContain('var(--fluent-border)');
  await expect(page.getByText('ENGINE READY', { exact: true })).toHaveCount(0);
  await page.locator('textarea').fill('attention lockdown personnel');
  await waitForReady(page);
  const audio = page.locator('audio');
  await expect(page.locator('.announcement-player')).toBeVisible();
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
  await expect(page.locator('.panel-tabs').getByRole('tab', { name: '导出' })).toHaveCount(0);
  const opusDownload = page.waitForEvent('download', { timeout: 90_000 });
  await page.locator('[data-command="opus"]').click();
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
  await openStudio(page);
  await page.locator('[data-command="live"]').click();
  await expect(page.getByRole('button', { name: '实时渲染' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '生成音频' })).toBeVisible();
  await page.locator('textarea').fill('zzyyxxunrecorded');
  await page.route('**/audio/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.getByRole('button', { name: '生成音频' }).click();
  await page.getByRole('button', { name: '取消渲染' }).click();
  await expect(page.getByText('渲染已取消')).toBeVisible();
  await page.unroute('**/audio/**');
  await page.locator('textarea').fill('attention all personnel');
  await page.getByRole('button', { name: '生成音频' }).click();
  await waitForReady(page);
  expect(errors).toEqual([]);
});

test('command authoring and editor remain compact at mobile widths with system Fluent theme', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  await expect(page.getByRole('button', { name: '停顿', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '卡顿', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '结束', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: '环境底噪' })).toHaveCount(0);
  await page.getByRole('button', { name: '停顿', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue(/<pause seconds="0\.5"\/>/);
  await expect(page.getByRole('heading', { name: '素材目录' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.fluent-theme')).toHaveAttribute('data-fluent-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
});

test('markup help and insertion preserve exact inline text and selections', async ({ page }) => {
  await openStudio(page);
  const field = page.locator('textarea');
  await expect(field).toBeEnabled();
  await openSideView(page, '帮助');
  await expect(page.getByText(/me<pitch value="1.2">tri<\/pitch>cs/)).toBeVisible();

  await field.fill('attention');
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await page.getByRole('button', { name: '音量', exact: true }).click();
  await expect(field).toHaveValue('attention<volume value="0.7">word</volume>');
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('word');

  await field.fill('metrics');
  await field.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(2, 5); });
  await page.getByRole('button', { name: '游戏音高', exact: true }).click();
  await expect(field).toHaveValue('me<pitch value="1.2">tri</pitch>cs');
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('tri');

  await field.fill('metrics');
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 2));
  await page.getByRole('button', { name: '素材片段', exact: true }).click();
  await expect(field).toHaveValue('me<clip id="a"/>trics');
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe('me<clip id="a"/>'.length);

  await field.fill('me<pitch value="1.2">tri</pitch>cs');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('data-complete', 'true', { timeout: 90_000 });
  await expect(page.locator('.highlight-layer')).toHaveText('me<pitch value="1.2">tri</pitch>cs');
  await expect(page.locator('.annotated-editor .token-gap')).toHaveCount(0);
  await expect(page.locator('.annotated-editor .token-marker')).toHaveCount(2);
  await expect(page.locator('.annotated-editor .token-synthesized')).toHaveCount(3);
  await expect(page.locator('.annotated-editor .token-error')).toHaveCount(0);

  await field.fill('<pitch value="1.2">attention</pitch> <volume value="0.7">personnel</volume> <pause seconds="0.5"/>');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('data-complete', 'true', { timeout: 90_000 });
  await expect(page.locator('.annotated-editor .token-marker')).toHaveCount(5);
  await expect(page.locator('.annotated-editor .token-error')).toHaveCount(0);
  expect(await page.locator('.highlight-layer').textContent()).toBe('<pitch value="1.2">attention</pitch> <volume value="0.7">personnel</volume> <pause seconds="0.5"/>');
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
  await openStudio(page);
  await page.locator('textarea').fill('/ a e: /');
  await waitForReady(page, 90000);
  await openPanel(page, /^分析/);
  await expect(page.locator('.analysis-details')).toContainText('语音片段');
  await expect(page.locator('.annotated-editor .token-synthesized')).toHaveText('/ a e: /');
  await expect(page.locator('.notice-item.sev-warning').filter({ hasText: /was stretched from/ })).toBeVisible();
  const phonemePath = info.outputPath('phonemes.wav');
  const bytes = await saveWav(page, phonemePath);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect((bytes.length - 44) / 96_000).toBeGreaterThan(0.15);
  expect((bytes.length - 44) / 96_000).toBeLessThan(0.6);

  await page.locator('textarea').fill('robot');
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
  const colours = await page.evaluate(() => {
    const decoration = (selector: string) => getComputedStyle(document.querySelector(selector)!).textDecorationColor;
    return { missing: decoration('.highlight-layer .spell-missing'), synthesized: decoration('.legend .token-synthesized'), error: decoration('.legend .token-error') };
  });
  expect(colours.missing).toBe(colours.synthesized);
  expect(colours.missing).not.toBe(colours.error);
  await waitForReady(page, 90000);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
