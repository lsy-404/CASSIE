import { expect, test } from '@playwright/test';
import { openRibbon, openStudio } from './helpers';

test('reading time group wraps the selection or the placeholder in a fit tag', async ({ page }) => {
  await openStudio(page);
  const field = page.locator('textarea');
  await openRibbon(page, '时间');
  const seconds = page.getByRole('spinbutton', { name: '秒数', exact: true });
  await expect(seconds).toHaveValue('2');
  await seconds.fill('3.5');
  await field.fill('attention all');
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 9));
  await page.getByRole('button', { name: '限定时长', exact: true }).click();
  await expect(field).toHaveValue('<fit seconds="3.5">attention</fit> all');
  await seconds.fill('999');
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
  await page.getByRole('button', { name: '限定时长', exact: true }).click();
  await expect(field).toHaveValue('<fit seconds="3.5">attention</fit> all<fit seconds="120">word</fit>');
});

test('ribbon tabs support arrow keys and double-click collapse', async ({ page }) => {
  await openStudio(page);
  const home = page.locator('.ribbon-tabs').getByRole('tab', { name: '主页', exact: true });
  await home.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ribbon-tabs').getByRole('tab', { name: '插入', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ribbon-tabs').getByRole('tab', { name: '插入', exact: true })).toBeFocused();
  await expect(page.locator('.ribbon-body')).toBeVisible();
  await page.locator('.ribbon-tabs').getByRole('tab', { name: '插入', exact: true }).dblclick();
  await expect(page.locator('.ribbon-body')).toHaveCount(0);
  await page.locator('.ribbon-tabs').getByRole('tab', { name: '插入', exact: true }).dblclick();
  await expect(page.locator('.ribbon-body')).toBeVisible();
  await expect(page.locator('.rb-caption').first()).toBeVisible();
});

test('shortcuts toggle the side bar and render, and the outline moves the cursor', async ({ page }) => {
  await openStudio(page);
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(sidebar).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(sidebar).toBeVisible();
  await page.locator('textarea').fill('cassie\n<pause seconds="0.5"/>');
  await page.locator('.outline button').filter({ hasText: '<pause' }).click();
  await expect.poll(() => page.locator('textarea').evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(7);
  await expect(page.locator('.statusbar')).toContainText('2');
  await page.locator('.live-controls label').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
});

test('theme accent is white, chrome is neutral grey and line numbers follow the text', async ({ page }) => {
  await openStudio(page);
  const tokens = await page.locator('.fluent-theme').evaluate((element) => {
    const style = getComputedStyle(element);
    return ['--fluent-accent', '--fluent-accent-hover', '--fluent-accent-pressed'].map((name) => style.getPropertyValue(name).trim());
  });
  expect(tokens[0]).toMatch(/^#f{3}(f{3})?$/);
  const channels = await page.evaluate(() => ['.titlebar', '.statusbar', '.ribbon', '.activitybar', '.sidebar'].map((selector) => {
    const [r, g, b] = getComputedStyle(document.querySelector(selector)!).backgroundColor.match(/\d+/g)!.map(Number);
    return Math.max(r, g, b) - Math.min(r, g, b);
  }));
  expect(Math.max(...channels)).toBeLessThanOrEqual(4);
  await page.locator('textarea').fill(Array.from({ length: 40 }, (_, index) => `line ${index} ${'long '.repeat(60)}`).join('\n'));
  const metrics = await page.evaluate(() => {
    const field = document.querySelector('textarea')!;
    const gutter = document.querySelector('.gutter pre')!;
    return { gutter: gutter.getBoundingClientRect().height, text: field.scrollHeight - 16, wrap: getComputedStyle(field).whiteSpace };
  });
  expect(metrics.wrap).toBe('pre');
  expect(Math.abs(metrics.gutter - metrics.text)).toBeLessThan(21);
});
