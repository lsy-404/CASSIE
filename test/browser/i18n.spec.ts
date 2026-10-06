import { openStudio, unlockTerminal } from './helpers';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('language follows browser locale and persists the selected translation', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('.titlebar .app-title')).toHaveText('Announcement editor');
  await expect(page.locator('.brand')).toContainText('C.A.S.S.I.E.');
  await expect(page.getByRole('button', { name: 'Live render' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /Speech rate/ })).toHaveValue('1');
  await expect(page.getByRole('group', { name: 'Voice processing' })).toHaveAttribute('title', /Uses the browser's WORLD DSP/);
  await expect(page.getByRole('slider', { name: 'Pitch shift (semitones)' })).toBeVisible();

  await page.getByRole('button', { name: 'Language' }).click();
  await expect(page.locator('.titlebar .app-title')).toHaveText('公告编辑器');
  await expect(page.locator('.brand')).toContainText('CENTRAL AUTONOMIC SERVICE SYSTEM FOR INTERNAL EMERGENCIES');
  await expect(page.getByRole('button', { name: '实时渲染' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /语速/ })).toBeVisible();
  await expect(page.getByRole('group', { name: '语音后处理' })).toHaveAttribute('title', /使用浏览器内的 WORLD DSP/);
  await expect(page.getByRole('slider', { name: '音调偏移（半音）' })).toBeVisible();

  await page.reload();
  await unlockTerminal(page);
  await expect(page.locator('.titlebar .app-title')).toHaveText('公告编辑器');
  await page.getByRole('button', { name: '语言' }).click();
  await expect(page.locator('.titlebar .app-title')).toHaveText('Announcement editor');
});
