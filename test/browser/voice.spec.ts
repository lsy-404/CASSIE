import { openPanel, openStudio, wavButton, test } from './helpers';
import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function wav(page: Page, text: string, path: string) {
  await openPanel(page, '播放器');
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: '生成音频', exact: true }).click();
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const pending = page.waitForEvent('download');
  await wavButton(page).click();
  await (await pending).saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
}

function bytes(samples: Int16Array) { return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength); }

function rms(samples: Int16Array): number {
  const core = samples.subarray(4_800, samples.length - 4_800);
  return Math.sqrt(core.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / core.length);
}

function peakFrequency(samples: Int16Array): number {
  const core = samples.subarray(4_800, samples.length - 4_800);
  let peak = 0;
  let frequency = 0;
  for (let hz = 100; hz <= 230; hz += 1) {
    const coefficient = 2 * Math.cos(2 * Math.PI * hz / 48_000);
    let previous = 0;
    let older = 0;
    for (let index = 0; index < core.length; index += 1) {
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (core.length - 1));
      const current = core[index] / 32768 * window + coefficient * previous - older;
      older = previous;
      previous = current;
    }
    const power = previous * previous + older * older - coefficient * previous * older;
    if (power > peak) { peak = power; frequency = hz; }
  }
  return frequency;
}

function periodicCorrelation(samples: Int16Array): number {
  const core = samples.subarray(4_800, samples.length - 4_800);
  let cross = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 300; index < core.length; index += 1) {
    cross += core[index] * core[index - 300];
    leftPower += core[index] ** 2;
    rightPower += core[index - 300] ** 2;
  }
  return cross / Math.sqrt(leftPower * rightPower);
}

test('WASM post-processing raises and lowers a known fundamental without changing duration', async ({ page }, info) => {
  const tone = await readFile(new URL('../fixtures/voice-tone.opus', import.meta.url));
  await page.route('**/audio/cassie.opus', (route) => route.fulfill({ body: tone, contentType: 'audio/ogg' }));
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('[data-command="live"]').click();
  const neutral = await wav(page, 'cassie', info.outputPath('known-tone.wav'));
  const raised = await wav(page, '<voice pitch="3">cassie</voice>', info.outputPath('known-tone-raised.wav'));
  const lowered = await wav(page, '<voice pitch="-3">cassie</voice>', info.outputPath('known-tone-lowered.wav'));
  const louder = await wav(page, '<voice loudness="6">cassie</voice>', info.outputPath('known-tone-louder.wav'));
  const softer = await wav(page, '<voice loudness="-6">cassie</voice>', info.outputPath('known-tone-softer.wav'));
  const tense = await wav(page, '<voice loudness="3" tension="0.7">cassie</voice>', info.outputPath('known-tone-tense.wav'));
  const tensionOnly = await wav(page, '<voice tension="0.7">cassie</voice>', info.outputPath('known-tone-tension-only.wav'));
  expect(raised.length).toBe(neutral.length);
  expect(lowered.length).toBe(neutral.length);
  expect(louder.length).toBe(neutral.length);
  expect(softer.length).toBe(neutral.length);
  expect(tense.length).toBe(neutral.length);
  expect(tensionOnly.length).toBe(neutral.length);
  expect(rms(louder) / rms(neutral)).toBeGreaterThan(1.7);
  expect(rms(softer) / rms(neutral)).toBeLessThan(0.55);
  expect(bytes(tensionOnly)).not.toEqual(bytes(neutral));
  expect(louder.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(32767);
  expect(Math.abs(peakFrequency(neutral) - 160)).toBeLessThan(2);
  expect(Math.abs(peakFrequency(raised) - 160 * 2 ** (3 / 12))).toBeLessThan(4);
  expect(Math.abs(peakFrequency(lowered) - 160 * 2 ** (-3 / 12))).toBeLessThan(4);
  const slider = page.getByRole('slider', { name: '音调偏移（半音）', exact: true });
  await expect(slider).toHaveValue('0');
  await slider.evaluate((element: HTMLInputElement) => {
    element.value = '3';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const globalRaised = await wav(page, 'cassie', info.outputPath('known-tone-global-raised.wav'));
  expect(globalRaised.length).toBe(neutral.length);
  expect(Math.abs(peakFrequency(globalRaised) - 160 * 2 ** (3 / 12))).toBeLessThan(4);
  const override = await wav(page, '<voice pitch="0">cassie</voice>', info.outputPath('known-tone-neutral-override.wav'));
  expect(bytes(override)).toEqual(bytes(neutral));
  const breathy = await wav(page, '<voice pitch="0" breathiness="0.8">cassie</voice>', info.outputPath('known-tone-breathy.wav'));
  expect(breathy.length).toBe(neutral.length);
  expect(periodicCorrelation(neutral)).toBeGreaterThan(0.95);
  expect(periodicCorrelation(breathy)).toBeLessThan(periodicCorrelation(neutral) - 0.05);
});

test('neutral voice bypasses processing and scoped voice restores original speech', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('[data-command="live"]').click();
  const word = await wav(page, 'cassie', info.outputPath('voice-word.wav'));
  const neutral = await wav(page, '<voice pitch="0" breathiness="0" formant="0">cassie</voice>', info.outputPath('voice-neutral.wav'));
  expect(bytes(neutral)).toEqual(bytes(word));
  const scoped = await wav(page, 'cassie <voice pitch="3" breathiness="0.3" formant="-2">cassie</voice> cassie', info.outputPath('voice-scope.wav'));
  const gap = Math.round(0.24 * 48_000);
  expect(scoped.length).toBe(word.length * 3 + gap * 2);
  expect(bytes(scoped.subarray(0, word.length))).toEqual(bytes(word));
  expect(bytes(scoped.subarray(-word.length))).toEqual(bytes(word));
  const body = scoped.subarray(word.length + gap, word.length * 2 + gap);
  expect(bytes(body)).not.toEqual(bytes(word));
  expect(Math.sqrt(body.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / body.length)).toBeGreaterThan(0.005);
  await expect(page.locator('.annotated-editor .token-marker')).toHaveCount(2);
  await expect(page.locator('.annotated-editor .token-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('voice processing preserves boundary cues, fixed gaps and explicit pauses', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('[data-command="live"]').click();
  const word = await wav(page, 'cassie', info.outputPath('voice-original.wav'));
  const start = await wav(page, '<start>', info.outputPath('voice-start.wav'));
  const end = await wav(page, '<end>', info.outputPath('voice-end.wav'));
  const normal = await wav(page, '<start>cassie cassie<br>cassie<end>', info.outputPath('voice-normal.wav'));
  const processed = await wav(page, '<voice pitch="-3" breathiness="0.45" formant="2" loudness="3" tension="0.5"><start>cassie cassie<br>cassie<end></voice>', info.outputPath('voice-processed.wav'));
  expect(processed.length).toBe(normal.length);
  expect(bytes(processed.subarray(0, start.length))).toEqual(bytes(start));
  expect(bytes(processed.subarray(-end.length))).toEqual(bytes(end));
  const gapStart = start.length + word.length;
  expect(bytes(processed.subarray(gapStart, gapStart + 11_520))).toEqual(bytes(normal.subarray(gapStart, gapStart + 11_520)));
  const pauseStart = gapStart + 11_520 + word.length;
  expect(bytes(processed.subarray(pauseStart, pauseStart + 24_000))).toEqual(bytes(normal.subarray(pauseStart, pauseStart + 24_000)));
  expect(errors).toEqual([]);
});

test('invalid voice parameters are red and markup remains literal', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('textarea')).toBeEnabled();
  await page.locator('textarea').fill('<voice pitch="99">cassie</voice> <voice breathiness="NaN">attention</voice>');
  await expect(page.locator('.annotated-editor .token-error').filter({ hasText: '<voice' })).toHaveCount(2);
  await expect(page.locator('.annotated-editor voice')).toHaveCount(0);
});
