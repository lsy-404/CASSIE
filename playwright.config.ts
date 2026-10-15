import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: './test/results',
  timeout: 120_000,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4174/projects/cassie/', locale: 'zh-CN' },
  projects: [
    { name: 'desktop', testIgnore: /mobile-boot/ },
    { name: 'mobile-chromium', testMatch: /mobile-boot|phoneme-degraded/, use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', testMatch: /mobile-boot|phoneme-degraded/, use: { ...devices['iPhone 14'] } },
  ],
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/projects/cassie/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
