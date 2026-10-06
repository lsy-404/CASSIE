import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openPanel, openStudio, wavButton } from './helpers';

async function renderSamples(page: import('@playwright/test').Page, text: string, output: string) {
  await openPanel(page, '播放器');
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: '生成音频', exact: true }).click();
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const download = page.waitForEvent('download');
  await wavButton(page).click();
  await (await download).saveAs(output);
  const bytes = await readFile(output);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  return (bytes.length - 44) / 2;
}

test('stutter loops a slice of the word, lengthening the audio and its timeline entry', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await page.locator('[data-command="live"]').click();
  const plain = await renderSamples(page, 'cassie', info.outputPath('plain.wav'));
  const stuttered = await renderSamples(page, '<stutter repeats="3" length="0.1">cassie</stutter>', info.outputPath('stuttered.wav'));
  expect(Math.abs(stuttered - (plain + 0.3 * 48_000))).toBeLessThan(8);
  await expect(page.locator('.annotated-editor .token-error')).toHaveCount(0);
  const segment = page.locator('.timeline-segment.timeline-recorded[data-track="0"]').first();
  const covered = await segment.evaluate((element) => ({ left: parseFloat((element as HTMLElement).style.left), width: parseFloat((element as HTMLElement).style.width) }));
  expect(covered.left).toBeCloseTo(0, 1);
  expect(covered.left + covered.width).toBeGreaterThan(99);
  const inline = await renderSamples(page, 'me<stutter repeats="2" length="0.05">tri</stutter>cs', info.outputPath('inline.wav'));
  const inlinePlain = await renderSamples(page, 'me<volume value="1">tri</volume>cs', info.outputPath('inline-plain.wav'));
  expect(Math.abs(inline - (inlinePlain + 0.1 * 48_000))).toBeLessThan(8);
  expect(errors).toEqual([]);
});
