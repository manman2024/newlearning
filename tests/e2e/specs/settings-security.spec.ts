import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('security settings', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('changes the password and rejects the old credential', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    const newPassword = 'NewPassword123456!';

    await loginByForm(page, user);
    await page.goto('/settings/security');

    const passwordForm = page.locator('form').filter({
      has: page.locator('input[name="currentPassword"]'),
    });
    await passwordForm
      .locator('input[name="currentPassword"]')
      .fill(user.password);
    await passwordForm.locator('input[name="newPassword"]').fill(newPassword);
    await passwordForm.locator('button[type="submit"]').click();
    await expect(
      passwordForm.locator('input[name="currentPassword"]')
    ).toHaveValue('');

    await page.getByTestId('sidebar-user-menu-trigger').click();
    await page.getByTestId('sidebar-sign-out').click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    const rejectedSignIn = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/sign-in/email') &&
        response.request().method() === 'POST'
    );
    await page.locator('form button[type="submit"]').click();
    expect((await rejectedSignIn).status()).toBeGreaterThanOrEqual(400);

    await page.locator('input[name="password"]').fill(newPassword);
    await loginByForm(page, { ...user, password: newPassword });
  });
});
