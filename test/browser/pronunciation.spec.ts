import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const paragraph = 'This is a unsupport word test. So I can make CASSIE read any word. We will also explore additional metrics beyond accuracy. This part was not yet discussed during lectures. Drawing the confusion matrix and ROC curve helps us compute metrics like false positive rate, false negative rate, precision, recall and AUC, which provide different ways to summarize and evaluate classifier behaviour. All of these summaries, along with manually inspecting errors, will help us understand the kind of incorrect predictions that a model makes, and how the data that the model was trained on shapes those mistakes.';

test('ordinary English and best-effort phonemes produce audible audio throughout the reported paragraph', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('.live-controls label').click({ timeout: 10_000 });
  await expect(page.getByRole('checkbox', { name: '实时渲染' })).not.toBeChecked();
  await expect(page.locator('textarea')).toBeEnabled();
  for (const word of ['a', 'I', 'unsupport', 'worksheet', 'metrics', 'beyond', 'accuracy']) {
    await page.locator('textarea').fill(word);
    await page.getByRole('button', { name: '生成公告音频', exact: true }).click();
    await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout: 30_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载 WAV', exact: true }).click();
    const artifact = await download;
    const output = info.outputPath(`${word.toLowerCase()}-speech.wav`);
    await artifact.saveAs(output);
    const bytes = await readFile(output);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt32LE(24)).toBe(48_000);
    const duration = (bytes.length - 44) / 96_000;
    expect(duration).toBeGreaterThan(0.04);
    expect(duration).toBeLessThan(3);
    const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / samples.length);
    expect(rms).toBeGreaterThan(0.005);
  }
  await page.locator('textarea').fill(paragraph);
  await page.getByRole('button', { name: '生成公告音频', exact: true }).click();
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Could not segment generated pronunciation|No audio clip|complete segment was skipped/)).toHaveCount(0);
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: /^metrics$/ })).toHaveCount(2);
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: /^beyond$/ })).toHaveCount(1);
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: /^accuracy$/ })).toHaveCount(1);
  await expect(page.locator('.annotated-editor .token-error').filter({ hasText: /^explore$/ })).toHaveCount(1);
  await expect(page.locator('.annotated-editor span').filter({ hasText: /^behaviour$/ })).not.toHaveClass(/spell-missing/);
  await page.locator('textarea').evaluate((field: HTMLTextAreaElement) => {
    field.scrollTop = field.scrollHeight;
    field.dispatchEvent(new Event('scroll'));
  });
  expect(await page.locator('.highlight-clip').evaluate((element) => getComputedStyle(element).overflow)).toBe('hidden');
  await page.screenshot({ path: info.outputPath('paragraph.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('announcement commands play the game boundary excerpts and highlight their source markers', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('textarea').fill('<start/> CASSIE <end/>');
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.annotated-editor .token-marker')).toHaveCount(2);
  await expect(page.locator('.annotated-editor .token-error')).toHaveCount(0);
  const audio = page.locator('audio');
  const duration = await audio.evaluate(async (element: HTMLAudioElement) => {
    if (element.readyState < 1) {
      await new Promise<void>((resolve) => element.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }
    element.currentTime = 0.1;
    element.dispatchEvent(new Event('seeking'));
    return element.duration;
  });
  expect(duration).toBeGreaterThan(13);
  expect(duration).toBeLessThan(16);
  await expect(page.locator('.annotated-editor .active')).toHaveText('<start/>');
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = element.duration - 0.5;
    element.dispatchEvent(new Event('seeking'));
  });
  await expect(page.locator('.annotated-editor .active')).toHaveText('<end/>');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV', exact: true }).click();
  await (await download).saveAs(info.outputPath('boundary-cues.wav'));
  expect(errors).toEqual([]);
});

test('uppercase recorded words stay case-insensitive while standalone I and unknown acronyms are spoken as English', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('textarea').fill('CASSIE I XYZ');
  await expect(page.getByText('公告已就绪', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.annotated-editor .token-recorded').filter({ hasText: /^CASSIE$/ })).toBeVisible();
  await expect(page.locator('.annotated-editor .token-synthesized').filter({ hasText: /^I$/ })).toBeVisible();
  const acronymLetters = page.locator('.annotated-editor .token-synthesized').filter({ hasText: /^[XYZ]$/ });
  await expect(acronymLetters).toHaveCount(3);
  expect((await acronymLetters.allTextContents()).join('')).toBe('XYZ');
  for (const letter of await acronymLetters.all()) await expect(letter).not.toHaveClass(/spell-missing/);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 WAV', exact: true }).click();
  const item = await download;
  const output = info.outputPath('uppercase-pronunciation.wav');
  await item.saveAs(output);
  const bytes = await readFile(output);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect((bytes.length - 44) / 96_000).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
