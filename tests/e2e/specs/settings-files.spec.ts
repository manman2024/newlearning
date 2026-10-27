import { expect, test, type Request } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('file settings', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('uploads, reads, and deletes a private file', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    const fileName = `e2e-file-${Date.now().toString().slice(-6)}.txt`;
    const fileBody = 'E2E private file fixture';

    await loginByForm(page, user);
    await page.goto('/settings/files');
    await page.waitForLoadState('networkidle');

    let serverFunctionRequest: Request | undefined;
    page.on('request', (outgoingRequest) => {
      const requestUrl = new URL(outgoingRequest.url());
      if (
        !serverFunctionRequest &&
        outgoingRequest.method() === 'POST' &&
        requestUrl.origin === new URL(page.url()).origin
      ) {
        serverFunctionRequest = outgoingRequest;
      }
    });

    await page.getByTestId('file-upload-trigger').click();
    const uploadDialog = page.getByTestId('file-upload-dialog');
    await uploadDialog.locator('#file-input').setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileBody),
    });
    await uploadDialog
      .locator('#description')
      .fill('Dependency upgrade regression fixture');
    await uploadDialog.getByTestId('file-upload-submit').click();

    const fileRow = page.getByRole('row').filter({ hasText: fileName });
    await expect(fileRow).toBeVisible();

    expect(serverFunctionRequest).toBeDefined();
    const replayHeaders = await serverFunctionRequest?.allHeaders();
    delete replayHeaders?.cookie;
    delete replayHeaders?.host;
    delete replayHeaders?.['content-length'];
    const crossSiteResponse = await page
      .context()
      .request.fetch(serverFunctionRequest?.url() ?? '', {
        method: 'POST',
        headers: {
          ...replayHeaders,
          origin: 'https://attacker.example',
          referer: 'https://attacker.example/',
          'sec-fetch-site': 'cross-site',
        },
        data: serverFunctionRequest?.postDataBuffer() ?? undefined,
      });
    expect(crossSiteResponse.status()).toBe(403);

    const fileUrl = await fileRow
      .locator('a[target="_blank"]')
      .getAttribute('href');
    expect(fileUrl).toBeTruthy();
    const download = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return {
        body: await response.text(),
        cacheControl: response.headers.get('cache-control'),
        contentDisposition: response.headers.get('content-disposition'),
        status: response.status,
      };
    }, fileUrl as string);
    expect(download).toEqual({
      body: fileBody,
      cacheControl: 'private, no-store',
      contentDisposition: 'attachment',
      status: 200,
    });

    await fileRow.locator('[data-testid^="file-actions-"]').click();
    await page.locator('[data-testid^="file-delete-"]').click();
    await expect(fileRow).toHaveCount(0);
  });
});
