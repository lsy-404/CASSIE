import { openPanel, openStudio, wavButton, test } from './helpers';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function renderWav(page: import('@playwright/test').Page, text: string, output: string) {
  await openPanel(page, '播放器');
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: '生成音频', exact: true }).click();
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const download = page.waitForEvent('download');
  await wavButton(page).click();
  await (await download).saveAs(output);
  const bytes = await readFile(output);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
}

test('typed scope tags end their volume effect and br creates an explicit pause', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('[data-command="live"]').click();
  await expect(page.getByRole('button', { name: '实时渲染' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('switch', { name: '环境底噪' })).toHaveCount(0);
  const baseline = await renderWav(page, 'cassie cassie cassie', info.outputPath('baseline.wav'));
  const scoped = await renderWav(page, 'cassie <volume value="0.25">cassie</volume> cassie', info.outputPath('volume-scope.wav'));
  expect(scoped.length).toBe(baseline.length);
  const gapSamples = Math.round(0.24 * 48_000);
  const wordSamples = (baseline.length - gapSamples * 2) / 3;
  const rms = (samples: Int16Array, start: number, end: number) => {
    const slice = samples.subarray(Math.round(start), Math.round(end));
    return Math.sqrt(slice.reduce((sum, value) => sum + value ** 2, 0) / slice.length);
  };
  expect(rms(scoped, 0, wordSamples) / rms(baseline, 0, wordSamples)).toBeCloseTo(1, 2);
  const middleStart = wordSamples + gapSamples;
  expect(rms(scoped, middleStart, middleStart + wordSamples) / rms(baseline, middleStart, middleStart + wordSamples)).toBeCloseTo(0.25, 2);
  const finalStart = 2 * (wordSamples + gapSamples);
  expect(rms(scoped, finalStart, scoped.length) / rms(baseline, finalStart, baseline.length)).toBeCloseTo(1, 2);
  await expect(page.locator('.annotated-editor .token-marker')).toHaveCount(2);
  const paused = await renderWav(page, 'cassie<br>cassie', info.outputPath('br-pause.wav'));
  expect(paused.length).toBeCloseTo(wordSamples * 2 + 24_000, -1);
  await expect(page.locator('.annotated-editor .token-marker')).toHaveCount(1);
  await expect(page.locator('.annotated-editor .token-marker')).toHaveText('<br>');
  const selfClosed = await renderWav(page, 'cassie<br/>cassie', info.outputPath('br-self-closed.wav'));
  expect(selfClosed.length).toBe(paused.length);
  await expect(page.locator('.annotated-editor .token-marker')).toHaveText('<br/>');
  expect(errors).toEqual([]);
});

test('manual markup is literal editor text and malformed closing tags are red', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('untrusted-image')) requests.push(request.url());
  });
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('textarea').fill('attention <img src="untrusted-image"/> <volume value="0.5">cassie</pitch>');
  await expect(page.locator('.annotated-editor .token-error').filter({ hasText: '</pitch>' })).toHaveCount(1);
  await expect(page.locator('.annotated-editor .token-error').filter({ hasText: '<img' })).toHaveCount(1);
  await expect(page.locator('.annotated-editor img')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('speech rate changes only speech while gaps, pauses and boundary cue PCM stay fixed', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('[data-command="live"]').click();
  const slider = page.getByRole('slider', { name: '语速', exact: true });
  await expect(slider).toHaveValue('1');
  const word = await renderWav(page, 'cassie', info.outputPath('rate-one-word.wav'));
  const start = await renderWav(page, '<start>', info.outputPath('rate-start.wav'));
  const end = await renderWav(page, '<end>', info.outputPath('rate-end.wav'));
  const text = '<start>cassie cassie<br>cassie<end>';
  const normal = await renderWav(page, text, info.outputPath('rate-normal.wav'));
  await slider.evaluate((element: HTMLInputElement) => {
    element.value = '1.5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(slider).toHaveValue('1.5');
  const fastWord = await renderWav(page, 'cassie', info.outputPath('rate-fast-word.wav'));
  expect(Math.abs(fastWord.length - word.length / 1.5)).toBeLessThan(3);
  const fast = await renderWav(page, text, info.outputPath('rate-fast.wav'));
  expect(Math.abs(fast.length - (normal.length - word.length * 3 + fastWord.length * 3))).toBeLessThan(5);
  expect(Buffer.from(fast.slice(0, start.length).buffer)).toEqual(Buffer.from(start.buffer));
  expect(Buffer.from(fast.slice(-end.length).buffer)).toEqual(Buffer.from(end.buffer));
  await page.locator('audio').evaluate((element: HTMLAudioElement, time) => {
    element.currentTime = time;
    element.dispatchEvent(new Event('seeking'));
  }, (start.length + fastWord.length) / 48_000 + 0.12);
  await expect(page.locator('.annotated-editor .active')).toHaveText(' ');
  expect(errors).toEqual([]);
});

test('custom controls play an early fragment while later audio is still loading', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('[data-command="live"]').click();
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/audio/cassie.opus', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.locator('textarea').fill('attention cassie personnel');
    await page.getByRole('button', { name: '生成音频', exact: true }).click();
    const audio = page.locator('audio');
    await expect(audio).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
    await expect(audio).toHaveAttribute('data-complete', 'false');
    await expect(audio).not.toHaveAttribute('controls');
    await expect(page.locator('.timeline-track .timeline-progress')).toBeVisible();
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
    release();
    await expect(audio).toHaveAttribute('data-complete', 'true', { timeout: 30_000 });
    await expect(page.locator('.timeline-track .timeline-progress')).toHaveCount(0);
    await expect(page.getByText('公告已就绪', { exact: true })).toHaveCount(0);
    await expect(page.locator('.panel-tabs').getByRole('tab', { name: '导出' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '渲染与导出', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { release(); }
});
