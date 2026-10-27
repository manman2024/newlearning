import { expect, test } from '@playwright/test';

test('web search presets, providers, validation and retry', async ({
  page,
}) => {
  await page.goto('/ai#web-search');
  await page.waitForLoadState('networkidle');
  const query = page.getByTestId('ai-web-search-query');
  const submit = page.getByTestId('ai-web-search-submit');
  await query.fill('   ');
  await expect(submit).toBeDisabled();
  for (let index = 0; index < 3; index++) {
    await page.getByTestId(`ai-web-search-preset-${index}`).click();
    await expect(submit).toBeEnabled();
  }
  const providers: string[] = [];
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    providers.push(route.request().postData() ?? '');
    await route.fulfill({ status: 503, body: 'Service unavailable' });
  });
  for (const provider of ['ceramic', 'exa', 'linkup'] as const) {
    await page.getByTestId('ai-web-search-provider').click();
    await page
      .getByRole('option', {
        name: { ceramic: 'Ceramic.ai', exa: 'Exa', linkup: 'Linkup' }[provider],
        exact: true,
      })
      .click();
    await expect(page.getByTestId('ai-web-search-error')).toHaveCount(0);
    await submit.click();
    await expect(page.getByTestId('ai-web-search-error')).toBeVisible();
    await expect(submit).toBeEnabled();
  }
  for (const [index, provider] of ['ceramic', 'exa', 'linkup'].entries()) {
    expect(providers[index]).toContain(provider);
  }
});

test('web search returns sources and clears results on provider change', async ({
  page,
}) => {
  await page.goto('/ai#web-search');
  await page.waitForLoadState('networkidle');
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          items: [
            {
              title: 'Search fixture',
              url: 'https://example.com/source',
              description: 'A search result.',
            },
          ],
        },
      }),
    });
  });
  await page.getByTestId('ai-web-search-submit').click();
  await expect(
    page.getByTestId('ai-web-search-result').locator('a')
  ).toHaveAttribute('href', 'https://example.com/source');
  await page.getByTestId('ai-web-search-provider').click();
  await page.getByRole('option', { name: 'Exa', exact: true }).click();
  await expect(page.getByTestId('ai-web-search-result')).toHaveCount(0);
});
