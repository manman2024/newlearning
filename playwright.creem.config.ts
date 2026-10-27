import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.CREEM_E2E_PORT ?? 3021);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const persistPath = './.wrangler/e2e-creem-state';

export default defineConfig({
  testDir: './tests/e2e/creem',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 120_000 },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      `E2E_PERSIST_PATH=${persistPath} pnpm exec tsx scripts/prepare-e2e-state.ts`,
      [
        'pnpm exec wrangler d1 migrations apply',
        '$(pnpm -s exec tsx scripts/get-db-name.ts)',
        '--local',
        `--persist-to ${persistPath}`,
      ].join(' '),
      [
        `E2E_PERSIST_PATH=${persistPath}`,
        `VITE_BASE_URL=${baseURL}`,
        'VITE_PAYMENT_PROVIDER=creem',
        'BETTER_AUTH_SECRET=e2e-better-auth-secret-at-least-32-characters',
        [
          'pnpm exec vite dev --config vite.payment-e2e.config.ts --mode e2e',
          '--host 127.0.0.1',
          `--port ${port}`,
          '--strictPort',
        ].join(' '),
      ].join(' '),
    ].join(' && '),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
