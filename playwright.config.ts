import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const persistPath = './.wrangler/e2e-state';

export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: [
      'pnpm exec tsx scripts/prepare-e2e-state.ts',
      [
        'pnpm exec wrangler d1 migrations apply',
        '$(pnpm -s exec tsx scripts/get-db-name.ts)',
        '--local',
        `--persist-to ${persistPath}`,
      ].join(' '),
      [
        `E2E_PERSIST_PATH=${persistPath}`,
        `VITE_BASE_URL=${baseURL}`,
        'VITE_PAYMENT_PROVIDER=stripe',
        'BETTER_AUTH_SECRET=e2e-better-auth-secret',
        [
          'pnpm exec vite dev --mode e2e',
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
