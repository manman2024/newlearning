import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('API key settings', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('creates and deletes an API key', async ({ page, request }) => {
    const user = await registerE2EUser(request);
    const keyName = `E2E key ${Date.now().toString().slice(-6)}`;

    await loginByForm(page, user);
    await page.goto('/settings/apikeys');

    await page.getByTestId('api-key-create-trigger').click();
    const createDialog = page.getByTestId('api-key-create-dialog');
    await createDialog.locator('#key-name').fill(keyName);
    await createDialog.getByTestId('api-key-create-submit').click();

    const secretDialog = page.getByTestId('api-key-secret-dialog');
    await expect(secretDialog).toBeVisible();
    await expect(secretDialog.locator('input[readonly]')).not.toHaveValue('');
    await secretDialog.getByTestId('api-key-secret-done').click();

    const keyRow = page.getByRole('row').filter({ hasText: keyName });
    await expect(keyRow).toBeVisible();
    await keyRow.locator('[data-testid^="api-key-actions-"]').click();
    await page.locator('[data-testid^="api-key-delete-"]').click();

    await expect(keyRow).toHaveCount(0);
  });
});
