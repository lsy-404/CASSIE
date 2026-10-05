import { openStudio } from './helpers';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function renderSeconds(page: import('@playwright/test').Page, text: string, output: string) {
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: '生成音频', exact: true }).click();
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV', exact: true }).click();
  await (await download).saveAs(output);
  const bytes = await readFile(output);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  return (bytes.length - 44) / 2 / 48_000;
}

test('fit stretches only the enclosed speech to the requested duration', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await page.locator('.live-controls label').click();
  await expect(page.getByRole('checkbox', { name: '实时渲染' })).not.toBeChecked();
  const single = await renderSeconds(page, 'cassie', info.outputPath('single.wav'));
  const gap = 0.24;
  for (const target of [single * 3 + gap * 2 + 1, single * 2 + gap]) {
    const whole = await renderSeconds(page, `<fit seconds="${target}">cassie cassie cassie</fit>`, info.outputPath(`whole-${target}.wav`));
    expect(Math.abs(whole - target)).toBeLessThan(0.05);
  }
  const scoped = await renderSeconds(page, 'cassie <fit seconds="1">cassie cassie</fit>', info.outputPath('scoped.wav'));
  expect(Math.abs(scoped - (single + gap + 1))).toBeLessThan(0.05);
  const overridden = await renderSeconds(page, '<rate value="2"><fit seconds="1">cassie cassie</fit></rate>', info.outputPath('override.wav'));
  expect(Math.abs(overridden - 1)).toBeLessThan(0.05);
  const clamped = await renderSeconds(page, '<fit seconds="0.05">cassie cassie</fit>', info.outputPath('clamped.wav'));
  expect(Math.abs(clamped - (single * 2 / 4 + gap))).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});
