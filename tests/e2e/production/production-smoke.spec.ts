import { expect, test } from '@playwright/test';

const ssrPages = [
  { path: '/' },
  { path: '/pricing' },
  { path: '/blog' },
  { path: '/auth/login' },
] as const;

test('production Worker serves SSR pages and the health API', async ({
  page,
  request,
}) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource: net::')
    ) {
      runtimeErrors.push(message.text());
    }
  });

  for (const { path } of ssrPages) {
    await test.step(path, async () => {
      const response = await page.goto(path, {
        waitUntil: 'domcontentloaded',
      });
      expect(response?.ok(), `${path} should return 2xx`).toBeTruthy();
      expect(response?.headers()['content-type']).toContain('text/html');
      await expect(page.locator('#main-content')).toBeVisible();
    });
  }

  expect(runtimeErrors).toEqual([]);

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.locator('input[name="email"]')).toBeVisible();

  const health = await request.get('/api/ping');
  await expect(health).toBeOK();
  expect(await health.json()).toEqual({ message: 'pong' });

  const testHelper = await request.delete('/api/e2e/users', {
    headers: { 'x-e2e-secret': 'local-e2e-secret' },
  });
  expect(testHelper.status()).toBe(404);
});
