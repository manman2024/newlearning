import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test('admin search matches special characters literally', async ({
  page,
  request,
}) => {
  await cleanupE2EUsers(request);
  try {
    const admin = await registerE2EUser(request, { role: 'admin' });
    const suffix = Date.now();
    const literal = await registerE2EUser(request, {
      name: 'Literal_100%\\Account',
      email: `e2e-${suffix}-literal@example.test`,
    });
    const decoy = await registerE2EUser(request, {
      name: 'LiteralX100extraAccount',
      email: `e2e-${suffix}xliteral@example.test`,
    });
    await loginByForm(page, admin);
    await page.goto('/admin/users');
    const search = page.getByTestId('admin-users-search');
    const literalRow = page.getByRole('row').filter({ hasText: literal.email });
    const decoyRow = page.getByRole('row').filter({ hasText: decoy.email });
    await expect(literalRow).toBeVisible();
    await expect(decoyRow).toBeVisible();

    for (const query of ['_', '%', '\\', literal.email]) {
      const response = page.waitForResponse(
        (result) =>
          result.request().method() === 'GET' &&
          result.url().includes('/_serverFn/')
      );
      await search.fill(query);
      expect((await response).ok()).toBeTruthy();
      await expect(literalRow).toBeVisible();
      await expect(decoyRow).toHaveCount(0);
    }

    const response = page.waitForResponse(
      (result) =>
        result.request().method() === 'GET' &&
        result.url().includes('/_serverFn/')
    );
    await search.fill('literal');
    expect((await response).ok()).toBeTruthy();
    await expect(literalRow).toBeVisible();
    await expect(decoyRow).toBeVisible();
  } finally {
    await cleanupE2EUsers(request);
  }
});
