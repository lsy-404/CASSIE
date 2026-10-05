import { expect, test } from '@playwright/test';
import { openStudio } from './helpers';

test('phoneme insertion reuses slash blocks and preserves selections and tag slashes', async ({ page }) => {
  await openStudio(page);
  const field = page.locator('textarea');
  await page.locator('.phone-inventory summary').click();
  const phone = page.getByRole('button', { name: '插入音素 ə', exact: true });
  await expect(phone).toBeVisible();
  await field.fill('<rate value="1.1">cassie</rate> / a e: /');
  await field.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(input.value.indexOf(' e:'), input.value.indexOf(' e:')));
  await phone.click();
  await expect(field).toHaveValue('<rate value="1.1">cassie</rate> / a ə e: /');
  await field.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(input.value.indexOf('e:'), input.value.indexOf('e:') + 2));
  await phone.click();
  await expect(field).toHaveValue('<rate value="1.1">cassie</rate> / a ə ə /');
  await field.fill('<clip id="cassie"/>');
  await field.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(input.value.length, input.value.length));
  await phone.click();
  await expect(field).toHaveValue('<clip id="cassie"/>/ ə /');
});

test('fine numeric fields stay stable when cleared and accept signed decimal voice controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openStudio(page);
  await expect(page.locator('.voice-processing')).toBeVisible();
  const loudness = page.getByRole('spinbutton', { name: '响度（dB）', exact: true });
  const tension = page.getByRole('spinbutton', { name: '张力', exact: true });
  const breathiness = page.getByRole('spinbutton', { name: '气声', exact: true });
  await loudness.fill('');
  await tension.focus();
  await expect(loudness).toHaveValue('0');
  await loudness.fill('-3.2');
  await tension.fill('0.23');
  await breathiness.fill('0.17');
  await page.locator('textarea').focus();
  await expect(page.getByRole('slider', { name: '响度（dB）', exact: true })).toHaveValue('-3.2');
  await expect(page.getByRole('slider', { name: '张力', exact: true })).toHaveValue('0.23');
  await expect(page.getByRole('slider', { name: '气声', exact: true })).toHaveValue('0.17');
  await loudness.fill('999');
  await page.locator('textarea').focus();
  expect(Number(await loudness.inputValue())).toBeLessThanOrEqual(12);
  expect(errors).toEqual([]);
});

test('one long timeline combines rendering and seeking and follows the audio clock between native events', async ({ page }) => {
  await openStudio(page);
  await page.locator('.live-controls label').click();
  await page.locator('textarea').fill('attention all personnel attention all personnel');
  await page.getByRole('button', { name: '生成音频', exact: true }).click();
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const seek = page.getByRole('slider', { name: '播放位置', exact: true });
  await expect(page.locator('.announcement-player input[type="range"]')).toHaveCount(1);
  await expect(page.locator('.announcement-player progress')).toHaveCount(0);
  const sliderBox = await seek.boundingBox();
  const trackBox = await page.locator('.timeline-overview').boundingBox();
  const panelBox = await page.locator('.main-column').boundingBox();
  expect(sliderBox!.width).toBeGreaterThan(panelBox!.width * 0.8);
  expect(Math.abs(trackBox!.y + trackBox!.height / 2 - sliderBox!.y - sliderBox!.height / 2)).toBeLessThan(3);
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.addEventListener('timeupdate', (event) => event.stopImmediatePropagation(), { capture: true }));
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(0.4);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const actualTime = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime);
  expect(Math.abs(Number(await seek.inputValue()) - actualTime)).toBeLessThan(0.03);
});
