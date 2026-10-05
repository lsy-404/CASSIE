import { openStudio, unlockTerminal } from './helpers';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('language follows browser locale and persists the selected translation', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('.page-heading h1')).toHaveText('Announcement editor');
  await expect(page.getByRole('checkbox', { name: 'Live render' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /Speech rate/ })).toHaveValue('1');
  await page.locator('.voice-processing summary').click();
  await expect(page.locator('.voice-processing')).toContainText('Uses the browser\'s WORLD DSP');
  await expect(page.getByRole('slider', { name: 'Pitch shift (semitones)' })).toBeVisible();

  await page.getByRole('button', { name: 'Language' }).click();
  await expect(page.locator('.page-heading h1')).toHaveText('公告编辑器');
  await expect(page.getByRole('checkbox', { name: '实时渲染' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /语速/ })).toBeVisible();
  await expect(page.locator('.voice-processing')).toContainText('使用浏览器内的 WORLD DSP');
  await expect(page.getByRole('slider', { name: '音调偏移（半音）' })).toBeVisible();

  await page.reload();
  await unlockTerminal(page);
  await expect(page.locator('.page-heading h1')).toHaveText('公告编辑器');
  await page.getByRole('button', { name: '语言' }).click();
  await expect(page.locator('.page-heading h1')).toHaveText('Announcement editor');
});
