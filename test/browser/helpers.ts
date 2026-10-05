import { expect, type Page } from '@playwright/test';

export async function unlockTerminal(page: Page) {
  const unlock = page.getByTestId('terminal-unlock');
  await expect(unlock).toBeEnabled({ timeout: 30_000 });
  await unlock.click();
  await expect(page.locator('textarea')).toBeEnabled({ timeout: 30_000 });
}

export async function openStudio(page: Page, path = '/') {
  await page.goto(path);
  await unlockTerminal(page);
}

async function select(tab: ReturnType<Page['locator']>) {
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

export async function openRibbon(page: Page, name: string) {
  await select(page.locator('.ribbon-tabs').getByRole('tab', { name, exact: true }));
}

export async function openSideView(page: Page, name: string) {
  await select(page.locator('.activitybar').getByRole('tab', { name, exact: true }));
}

export async function openPanel(page: Page, name: string | RegExp) {
  await select(page.locator('.panel-tabs').getByRole('tab', typeof name === 'string' ? { name, exact: true } : { name }));
}

export async function wavLink(page: Page, name = '下载 WAV') {
  await openPanel(page, name === '下载 WAV' ? '导出' : 'Export');
  return page.getByRole('link', { name, exact: true });
}
