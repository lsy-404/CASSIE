import { expect, test } from '@playwright/test';

const links = [
  { selector: 'link[rel="icon"][type="image/svg+xml"]', href: '/favicon.svg', type: /^image\/svg\+xml/ },
  { selector: 'link[rel="icon"][sizes="32x32"]', href: '/favicon.ico', type: /^image\/(x-icon|vnd\.microsoft\.icon)/ },
  { selector: 'link[rel="apple-touch-icon"]', href: '/apple-touch-icon.png', type: /^image\/png/ },
];

test('icon links resolve with the right type and size', async ({ page, request }) => {
  await page.goto('/');
  for (const { selector, href, type } of links) {
    await expect(page.locator(selector)).toHaveAttribute('href', href);
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect(response.headers()['content-type'], href).toMatch(type);
    expect((await response.body()).length, href).toBeGreaterThan(500);
  }
});
