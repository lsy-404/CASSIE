import { expect, test } from '@playwright/test';
import { openSideView, openStudio } from './helpers';

test('the help view lists every tag and hosts the colour legend, which is gone from under the editor', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('.token-legend')).toHaveCount(0);
  await openSideView(page, '帮助');
  await expect(page.locator('.sidebar-title')).toHaveText('帮助');
  const help = page.locator('#sidebar-help');
  await expect(help).toBeVisible();
  for (const tag of ['<fit seconds="2">', '<sync><voice pitch="4">contain</voice></sync> contain', '<sync><volume value="0.5"><pause seconds="0.15"/>contain</volume></sync> contain', '<stutter', '<pause', '<clip']) await expect(help).toContainText(tag);
  await expect(help).toContainText('严格模式');
  const legend = help.getByTestId('legend');
  for (const label of ['识别命令', '原始录音', '合成音频', '无法合成', '有修复建议', '被严格模式阻止', '提示音与效果', '同步音轨']) await expect(legend).toContainText(label);
  await openSideView(page, '设置');
  await expect(page.locator('.sidebar-title')).toHaveText('设置');
});

test('the player progress bar has exactly one marker, the shared diamond thumb', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('.announcement-player input[type="range"]')).toHaveCount(1);
  await expect(page.locator('.announcement-player .diamond-slider')).toHaveCount(1);
  await expect(page.locator('.timeline-playhead')).toHaveCount(0);
});

test('timeline segments use the editor token colours and sync tracks get thin lanes', async ({ page }) => {
  await openStudio(page);
  await page.locator('textarea').fill('<start> cassie <sync>cassie zzyzx</sync> <pause seconds="0.5"/> cassie');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const colour = (selector: string, property: 'backgroundColor' | 'textDecorationColor') => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s)!)[p as 'backgroundColor'], [selector, property]);
  const recorded = page.locator('.timeline-segment.timeline-recorded[data-track="0"]').first();
  await expect(recorded).toBeVisible();
  expect(await recorded.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await colour('.legend .token-recorded', 'textDecorationColor'));
  const synthesized = page.locator('.timeline-segment.timeline-synthesized').first();
  expect(await synthesized.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await colour('.legend .token-synthesized', 'textDecorationColor'));
  await expect(page.locator('.timeline-segment.timeline-cue')).not.toHaveCount(0);
  await expect(page.locator('.timeline-segment.timeline-gap').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const lane = page.locator('.timeline-segment.timeline-sync[data-track="1"]').first();
  await expect(lane).toBeVisible();
  const [mainBox, laneBox] = await Promise.all([recorded.boundingBox(), lane.boundingBox()]);
  expect(laneBox!.height).toBeLessThan(mainBox!.height);
  expect(laneBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height);
});

test('the seek slider track is transparent so segment colours show on the progress bar', async ({ page }) => {
  await openStudio(page);
  await page.locator('textarea').fill('cassie');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  const track = await page.locator('.announcement-player input[type="range"]').evaluate((input) => getComputedStyle(input, '::-webkit-slider-runnable-track').backgroundColor);
  expect(track).toBe('rgba(0, 0, 0, 0)');
});

test('the sync ribbon command wraps the selection or the placeholder and renders a second lane', async ({ page }) => {
  await openStudio(page);
  const field = page.locator('textarea');
  await field.fill('cassie contain');
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 14));
  await page.locator('[data-command="scope.sync"]').click();
  await expect(field).toHaveValue('cassie <sync>contain</sync>');
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await page.locator('[data-command="scope.sync"]').click();
  await expect(field).toHaveValue('cassie <sync>contain</sync><sync>word</sync>');
  await field.fill('<sync>contain</sync> contain');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  await expect(page.locator('.timeline-segment[data-track="1"]')).not.toHaveCount(0);
});

test('the panel header keeps a visible panel toggle and the ribbon no longer has view buttons', async ({ page }) => {
  await openStudio(page);
  for (const id of ['sidebar', 'panel', 'ribbon', 'help', 'insertPhonemes']) await expect(page.locator(`.ribbon [data-command="${id}"]`)).toHaveCount(0);
  await expect(page.locator('.panel-header .close')).toBeVisible();
});
