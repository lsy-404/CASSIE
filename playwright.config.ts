import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: './test/results',
  timeout: 120_000,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:8787', locale: 'zh-CN' },
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'npx wrangler dev --ip 127.0.0.1 --port 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
