import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function renderWav(page: import('@playwright/test').Page, text: string, output: string) {
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: '生成公告音频', exact: true }).click();
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV', exact: true }).click();
  await (await download).saveAs(output);
  const bytes = await readFile(output);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
}

test('typed scope tags end their volume effect and br creates an explicit pause', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('.live-controls label').click();
  await expect(page.getByRole('checkbox', { name: '实时渲染' })).not.toBeChecked();
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
  await page.goto('/');
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('textarea').fill('attention <img src="untrusted-image"/> <volume value="0.5">cassie</pitch>');
  await expect(page.locator('.annotated-editor .token-error').filter({ hasText: '</pitch>' })).toHaveCount(1);
  await expect(page.locator('.annotated-editor .token-error').filter({ hasText: '<img' })).toHaveCount(1);
  await expect(page.locator('.annotated-editor img')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('nested stutters repeat their full scopes and advance past overlapping speech', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('.live-controls label').click();
  const word = await renderWav(page, 'cassie', info.outputPath('one-word.wav'));
  const nested = await renderWav(page,
    '<stutter repeats="1">cassie <stutter repeats="1">cassie</stutter></stutter> cassie',
    info.outputPath('nested.wav'));
  expect(Math.abs(nested.length - (word.length * 7 + 0.72 * 48_000))).toBeLessThan(8);
  const body = '<spacing seconds="0.01">all remaining personnel attention</spacing>';
  const overlapping = await renderWav(page, body, info.outputPath('overlapping.wav'));
  const repeated = await renderWav(page, `<stutter repeats="1">${body}</stutter> cassie`, info.outputPath('overlapping-repeat.wav'));
  const leadingSpacingSamples = 0.01 * 48_000;
  expect(Math.abs(repeated.length - (overlapping.length * 2 - leadingSpacingSamples + word.length + 0.24 * 48_000))).toBeLessThan(8);
  await page.locator('audio').evaluate((element: HTMLAudioElement, currentTime) => {
    element.currentTime = currentTime;
    element.dispatchEvent(new Event('seeking'));
  }, overlapping.length * 2 / 48_000 + 0.34);
  await expect(page.locator('.annotated-editor .active')).toHaveText('cassie');
  expect(errors).toEqual([]);
});
