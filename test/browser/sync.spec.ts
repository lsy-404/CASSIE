import { openPanel, openStudio, wavButton } from './helpers';
import { expect, test } from '@playwright/test';
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

const rms = (samples: Int16Array, start: number, end: number) => {
  const slice = samples.subarray(Math.round(start), Math.round(end));
  return Math.sqrt(slice.reduce((sum, value) => sum + value ** 2, 0) / slice.length);
};

test('sync content plays beside the next main item and the longest track sets the length', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await page.locator('[data-command="live"]').click();
  await expect(page.getByRole('button', { name: '实时渲染' })).toHaveAttribute('aria-pressed', 'false');
  const baseline = await renderWav(page, 'cassie cassie', info.outputPath('baseline.wav'));
  const synced = await renderWav(page, 'cassie <sync>cassie</sync> cassie', info.outputPath('synced.wav'));
  expect(synced.length).toBe(baseline.length);
  const gapSamples = Math.round(0.24 * 48_000);
  const wordSamples = (baseline.length - gapSamples) / 2;
  const secondStart = wordSamples + gapSamples;
  expect(rms(synced, 0, wordSamples) / rms(baseline, 0, wordSamples)).toBeCloseTo(1, 2);
  expect(rms(synced, secondStart, baseline.length) / rms(baseline, secondStart, baseline.length)).toBeGreaterThan(1.5);
  const longer = await renderWav(page, 'cassie <sync>cassie cassie cassie</sync> cassie', info.outputPath('longer.wav'));
  expect(Math.abs(longer.length - (secondStart + 3 * wordSamples + 2 * gapSamples))).toBeLessThan(48);
  expect(errors).toEqual([]);
});
