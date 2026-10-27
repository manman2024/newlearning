import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3020);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const persistPath = './.wrangler/e2e-state';
const runtimeEnv = [
  `E2E_PERSIST_PATH=${persistPath}`,
  `VITE_BASE_URL=${baseURL}`,
  'VITE_PAYMENT_PROVIDER=stripe',
  'BETTER_AUTH_SECRET=e2e-better-auth-secret',
].join(' ');

export default defineConfig({
  testDir: './tests/e2e/production',
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
      `${runtimeEnv} pnpm build`,
      [
        runtimeEnv,
        'pnpm exec vite preview',
        '--host 127.0.0.1',
        `--port ${port}`,
        '--strictPort',
      ].join(' '),
    ].join(' && '),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
