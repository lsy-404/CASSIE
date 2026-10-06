import { expect, test } from '@playwright/test';
import { openSideView, openStudio } from './helpers';

test('reading time group wraps the selection or the placeholder in a fit tag', async ({ page }) => {
  await openStudio(page);
  const field = page.locator('textarea');
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

test('the ribbon is one flat page showing every group with its caption and no tabs', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('.ribbon [role="tab"]')).toHaveCount(0);
  const captions = await page.locator('.rb-caption').allTextContents();
  expect(captions).toEqual(['渲染', '导出', '标记', '效果', '时序', '朗读时长', '音素', '视图', '全局混音', '语音后处理']);
  await expect(page.locator('.rb-group').first()).toBeVisible();
  for (const name of ['语速', '音调偏移（半音）', '气声']) await expect(page.getByRole('slider', { name, exact: true })).toBeVisible();
  await expect(page.locator('.activitybar [role="tab"]')).toHaveCount(2);
  await expect(page.locator('.sidebar-title')).toHaveText('大纲');
  await expect(page.locator('.panel-tabs [role="tab"]')).toHaveText([/^播放器$/, /^分析/]);
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
  await page.locator('[data-command="live"]').click();
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
    const gutter = document.querySelector('.gutter-lines')!;
    return { gutter: gutter.getBoundingClientRect().height, text: field.scrollHeight - 16, wrap: getComputedStyle(field).whiteSpace };
  });
  expect(metrics.wrap).toBe('pre-wrap');
  expect(Math.abs(metrics.gutter - metrics.text)).toBeLessThan(21);
});

test('long lines wrap and line numbers stay on the first visual row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  await page.locator('textarea').fill(`short\n${'wrap '.repeat(60)}\nlast`);
  const layout = await page.evaluate(() => {
    const field = document.querySelector('textarea')!;
    const rows = [...document.querySelectorAll<HTMLElement>('.gutter-line')].map((row) => row.getBoundingClientRect().height);
    const clip = document.querySelector('.highlight-clip')!;
    const layer = document.querySelector('.highlight-layer')!;
    return { rows, overflow: field.scrollWidth - field.clientWidth, layer: layer.getBoundingClientRect().width, clip: clip.getBoundingClientRect().width };
  });
  expect(layout.overflow).toBe(0);
  expect(layout.layer).toBeLessThanOrEqual(layout.clip + 1);
  expect(layout.rows[0]).toBe(20);
  expect(layout.rows[1]).toBeGreaterThan(40);
  expect(layout.rows[2]).toBe(20);
});

test('the ribbon can be hidden and shown from the keyboard and the toggle strip', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: /^折叠功能区/ }).click();
  await expect(page.locator('.ribbon-body')).toHaveCount(0);
  await expect(page.locator('#ribbon-show')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ribbon-body')).toBeVisible();
  await page.keyboard.press('Control+F1');
  await expect(page.locator('.ribbon-body')).toHaveCount(0);
  await page.keyboard.press('Control+F1');
  await expect(page.locator('.ribbon-body')).toBeVisible();
  await page.locator('[data-command="ribbon"]').click();
  await expect(page.locator('.ribbon-body')).toHaveCount(0);
  await page.locator('#ribbon-show').click();
  await expect(page.locator('.ribbon-body')).toBeVisible();
});

test('the compact side bar overlay closes on Escape and returns focus to the activity bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  await openSideView(page, '大纲');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.activitybar').getByRole('tab', { name: '大纲', exact: true })).toBeFocused();
});

test('the narrow ribbon scrolls with edge buttons and keeps captions clear of the buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  const right = page.getByRole('button', { name: '向右滚动功能区' });
  await expect(right).toBeVisible();
  await right.click();
  await expect.poll(() => page.locator('.ribbon-body').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const overlap = await page.evaluate(() => {
    const caption = document.querySelector('.rb-caption')!.getBoundingClientRect().top;
    const buttons = [...document.querySelectorAll('.rb-large')].map((button) => button.getBoundingClientRect().bottom);
    return Math.max(...buttons) - caption;
  });
  expect(overlap).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('every slider shares the diamond thumb and the player seek bar follows the same style', async ({ page }) => {
  await openStudio(page);
  const sliders = await page.evaluate(() => [...document.querySelectorAll('input[type="range"]')].map((input) => ({ diamond: input.classList.contains('diamond-slider'), name: input.getAttribute('aria-label') })));
  expect(sliders.length).toBeGreaterThanOrEqual(10);
  for (const slider of sliders) expect(slider.diamond, String(slider.name)).toBe(true);
  expect(sliders.map((slider) => slider.name)).toContain('播放位置');
  const rules = await page.evaluate(() => Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText.startsWith('.diamond-slider::'))
    .map((rule) => ({ selector: rule.selectorText, text: rule.style.cssText })));
  expect(rules.map((rule) => rule.selector)).toContain('.diamond-slider::-webkit-slider-thumb');
  for (const rule of rules) {
    expect(rule.text).toContain('rotate(45deg)');
    expect(rule.text).toMatch(/border-radius: 0(px)?/);
    expect(rule.text).toMatch(/background: (rgb\(255, 255, 255\)|#fff|white)/);
  }
});

test('token colours: blue commands, green recorded, yellow synthesized, red errors, wavy fixes and dashed blocked words', async ({ page }) => {
  await openStudio(page);
  const colours = await page.evaluate(() => {
    const probe = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return { colour: style.textDecorationColor, style: style.textDecorationStyle, line: style.textDecorationLine };
    };
    return {
      marker: probe('.token-legend .token-marker'), recorded: probe('.token-legend .token-recorded'),
      synthesized: probe('.token-legend .token-synthesized'), error: probe('.token-legend .token-error'),
      blocked: probe('.token-legend .blocked'), fixable: probe('.token-legend .fixable'),
    };
  });
  expect(colours.marker.colour).toBe('rgb(86, 156, 214)');
  expect(new Set([colours.recorded.colour, colours.synthesized.colour, colours.error.colour, colours.marker.colour]).size).toBe(4);
  for (const key of ['marker', 'recorded', 'synthesized', 'error'] as const) expect(colours[key]).toMatchObject({ style: 'solid', line: 'underline' });
  expect(colours.blocked.style).toBe('dashed');
  expect(colours.blocked.colour).toBe(colours.synthesized.colour);
  expect(colours.fixable.style).toBe('wavy');
  expect(colours.fixable.colour).toBe(colours.synthesized.colour);
});

test('a fixable error is a wavy red token whose tooltip carries the fix', async ({ page }) => {
  await openStudio(page);
  await page.locator('textarea').fill('cassie <pause seconds="9999"/> cassie');
  const fixable = page.locator('.highlight-layer .token-error.fixable');
  await expect(fixable.first()).toHaveAttribute('title', /修复/);
  await expect(fixable.first()).toHaveCSS('text-decoration-style', 'wavy');
  await expect(fixable.first()).toHaveCSS('text-decoration-color', await page.locator('.token-legend .token-error').evaluate((element) => getComputedStyle(element).textDecorationColor));
});

test('the unrecorded words toggle switches strict mode end to end', async ({ page }) => {
  await openStudio(page);
  const toggle = page.locator('[data-command="synthesis"]');
  const field = page.locator('textarea');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await field.fill('cassie robot');
  await expect(page.locator('.highlight-layer .token-synthesized').filter({ hasText: 'robot' })).toBeVisible();
  await expect(page.locator('.highlight-layer .blocked')).toHaveCount(0);
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('audio[data-complete="true"]')).toHaveCount(0);
  const blocked = page.locator('.highlight-layer .token-synthesized.blocked');
  await expect(blocked).toHaveText('robot');
  await expect(blocked).toHaveCSS('text-decoration-style', 'dashed');
  await expect(page.locator('.highlight-layer .token-recorded').filter({ hasText: 'cassie' })).toBeVisible();
  await expect(page.locator('.panel-tabs [data-severity="warning"]')).toHaveText('1');
  await page.locator('#panel-tab-analysis').click();
  const warning = page.locator('.notice-item.sev-warning').filter({ hasText: /robot/ });
  await expect(warning).toBeVisible();
  await warning.click();
  await expect.poll(() => field.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(7);
  await expect(page.locator('audio[data-complete="true"]')).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.highlight-layer .blocked')).toHaveCount(0);
});

test('the analysis tab lists phoneme synthesis as info, filters by severity and counts them on the tab', async ({ page }) => {
  await openStudio(page);
  await page.locator('textarea').fill('cassie robot <pause seconds="9999"/>');
  await page.locator('#panel-tab-analysis').click();
  const info = page.locator('.notice-item.sev-info').filter({ hasText: /robot/ });
  await expect(info).toBeVisible();
  await expect(page.locator('.panel-tabs [data-severity="info"]')).toHaveText('1');
  await expect(page.locator('.panel-tabs [data-severity="error"]')).toBeVisible();
  await page.locator('.filter[data-severity="info"]').click();
  await expect(info).toHaveCount(0);
  await page.locator('.filter[data-severity="info"]').click();
  await expect(info).toBeVisible();
  await expect(page.locator('.panel-tabs').getByRole('tab', { name: /导出|问题/ })).toHaveCount(0);
});
