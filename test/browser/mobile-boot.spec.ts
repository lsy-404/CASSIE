import { expect, test } from '@playwright/test';
import { waitForStudio } from './helpers';

test('the full boot sequence, including the phoneme worker, completes under mobile emulation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('terminal-log')).toBeVisible();
  await waitForStudio(page);
  expect(errors).toEqual([]);
});

test('the phoneme worker is served as JavaScript and its boot step completes', async ({ page }) => {
  const worker = page.waitForResponse((response) => /phoneme\.worker-.*\.js$/.test(response.url()));
  await page.goto('/');
  const response = await worker;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/javascript/);
  await expect(page.getByTestId('terminal-status')).toHaveText('SYSTEM READY', { timeout: 60_000 });
  await expect(page.locator('[data-testid="terminal-step"]', { hasText: 'spawn phoneme worker' })).toContainText('[ OK ]');
});
