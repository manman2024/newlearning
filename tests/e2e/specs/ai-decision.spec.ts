import { expect, test } from '@playwright/test';

test('decision demo validates input, switches models and recovers from failure', async ({
  page,
}) => {
  await page.goto('/ai#decision-model');
  await page.waitForLoadState('networkidle');
  const input = page.getByTestId('ai-decision-state');
  const submit = page.getByTestId('ai-decision-submit');
  await input.fill('   ');
  await expect(submit).toBeDisabled();
  await page.getByTestId('ai-decision-preset-1').click();
  await expect(submit).toBeEnabled();
  await page.getByTestId('ai-decision-model').click();
  await page
    .getByRole('option', { name: '@cf/cloudflare/clef-flash', exact: true })
    .click();
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, body: 'Service unavailable' });
    } else {
      await route.continue();
    }
  });
  await submit.click();
  await expect(page.getByTestId('ai-decision-error')).toBeVisible();
  await expect(submit).toBeEnabled();
  await page.getByTestId('ai-decision-preset-0').click();
  await expect(page.getByTestId('ai-decision-error')).toHaveCount(0);
  await submit.click();
  await expect(page.getByTestId('ai-decision-error')).toBeVisible();
});
