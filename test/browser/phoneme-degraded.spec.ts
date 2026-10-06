import { expect, test, type Page } from '@playwright/test';
import { openSideView } from './helpers';

const CASES = [
  {
    name: 'never replies after loading',
    script: () => "postMessage({ type: 'stage', stage: 'module loaded' }); onmessage = () => {};",
    reason: /Worker gave no reply within 20 s/,
    stage: 'module loaded',
  },
  {
    name: 'never starts at all',
    script: () => '',
    reason: /Worker gave no reply within 20 s/,
    stage: 'never started',
  },
  {
    name: 'throws while the module initialises',
    script: (real: string) => `${real}\n;throw new Error('init boom');`,
    reason: /init boom/,
    stage: 'module loaded|loading engine',
  },
  {
    name: 'rejects asynchronously',
    script: (real: string) => `${real}\n;Promise.reject(new TypeError('async boom'));`,
    reason: /TypeError: async boom/,
    stage: 'module loaded|loading engine',
  },
];

async function breakWorker(page: Page, script: (real: string) => string) {
  await page.route(/phoneme\.worker-[^/]*\.js$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: script(source) });
  });
}

for (const broken of CASES) {
  test(`a phoneme worker that ${broken.name} degrades boot to a warning and opens the studio`, async ({ page }) => {
    await breakWorker(page, broken.script);
    await page.goto('/');
    const step = page.locator('[data-testid="terminal-step"]', { hasText: 'spawn phoneme worker' });
    await expect(step).toContainText('[WARN]', { timeout: 45_000 });
    await expect(step).toContainText(broken.reason);
    await expect(step).toContainText(new RegExp(`last stage: (?:${broken.stage})\\)`));
    await expect(page.locator('[data-testid="terminal-step"]', { hasText: 'spawn spelling worker' })).toContainText('[ OK ]');
    await expect(page.locator('[data-testid="terminal-step"]', { hasText: 'spawn render worker' })).toContainText('[ OK ]');
    await expect(page.locator('textarea')).toBeEnabled({ timeout: 45_000 });

    await page.locator('textarea').fill('cassie metrics');
    await expect(page.locator('.highlight-layer .token-recorded').filter({ hasText: 'cassie' })).toBeVisible();
    await expect(page.locator('.highlight-layer .token-error').filter({ hasText: 'metrics' })).toBeVisible();
    await expect(page.locator('.highlight-layer .token-synthesized')).toHaveCount(0);
    await page.locator('#panel-tab-analysis').click();
    await expect(page.locator('.notice-item.sev-warning').filter({ hasText: '此设备上音素引擎不可用' })).toHaveCount(1);

    await openSideView(page, '设置');
    const section = page.locator('[data-section="synthesis"]');
    await expect(section.getByRole('switch')).not.toBeChecked();
    await expect(section.getByRole('switch')).toBeDisabled();
    await expect(section.getByTestId('phoneme-unavailable')).toContainText('此设备上音素引擎不可用');
    await expect(section.getByTestId('phoneme-unavailable')).toContainText(broken.reason);
  });
}

test('a halted boot leaves no pending phoneme line', async ({ page }) => {
  await breakWorker(page, () => '');
  await page.route(/spelling\.worker-[^/]*\.js$/, (route) => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(page.locator('[data-testid="terminal-step"]', { hasText: 'spawn spelling worker' })).toContainText('[FAIL]', { timeout: 45_000 });
  const step = page.locator('[data-testid="terminal-step"]', { hasText: 'spawn phoneme worker' });
  await expect(step).toContainText('[WARN]');
  await expect(step).toContainText('startup halted');
  await expect(page.locator('[data-testid="terminal-step"]', { hasText: '[PEND]' })).toHaveCount(0);
});
