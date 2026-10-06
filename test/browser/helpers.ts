import { expect, test as base, type Page } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  },
});

export async function waitForStudio(page: Page) {
  await expect(page.locator('textarea')).toBeEnabled({ timeout: 30_000 });
}

export async function openStudio(page: Page, path = '/') {
  await page.goto(path);
  await waitForStudio(page);
}

async function select(tab: ReturnType<Page['locator']>) {
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

export async function openSideView(page: Page, name: string) {
  await select(page.locator('.activitybar').getByRole('tab', { name, exact: true }));
}

export async function openPanel(page: Page, name: string | RegExp) {
  await select(page.locator('.panel-tabs').getByRole('tab', typeof name === 'string' ? { name, exact: true } : { name }));
}

export function wavButton(page: Page) {
  return page.locator('[data-command="wav"]');
}
