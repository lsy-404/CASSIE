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
