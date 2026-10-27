import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  expectHealthyPage,
  installPageHealthMonitor,
  localizedPath,
  type LocaleMode,
} from '../fixtures/page-health';

const protectedPages = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/admin/users', name: 'admin users' },
  { path: '/settings/profile', name: 'profile settings' },
  { path: '/settings/security', name: 'security settings' },
  { path: '/settings/apikeys', name: 'api keys settings' },
  { path: '/settings/files', name: 'files settings' },
  { path: '/settings/billing', name: 'billing settings' },
  { path: '/settings/payment', name: 'payment result' },
  { path: '/settings/notifications', name: 'notification settings' },
] as const;

const locales: LocaleMode[] = ['en', 'zh'];

test.describe('protected page smoke coverage', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  for (const locale of locales) {
    test(`renders all protected pages in ${locale}`, async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, { role: 'admin' });
      const monitor = installPageHealthMonitor(page);

      await loginByForm(page, user);

      for (const protectedPage of protectedPages) {
        await test.step(protectedPage.name, async () => {
          await expectHealthyPage(
            page,
            monitor,
            localizedPath(protectedPage.path, locale)
          );
        });
      }
    });
  }

  test('keeps the desktop sidebar collapsed across protected route groups', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request, { role: 'user' });
    await loginByForm(page, user);

    const sidebar = page.locator('[data-slot="sidebar"]');
    await page.locator('[data-sidebar="trigger"]').click();
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

    await sidebar.locator('a[href$="/settings/profile"]').click();
    await expect(page).toHaveURL(/\/settings\/profile\/?$/);
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

    await sidebar.locator('a[href$="/settings/security"]').click();
    await expect(page).toHaveURL(/\/settings\/security\/?$/);
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

    await sidebar.locator('a[href$="/dashboard"]').click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  });
});
