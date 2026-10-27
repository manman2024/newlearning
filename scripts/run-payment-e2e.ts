import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWranglerConfig } from './parse-wrangler';
import {
  getPaymentE2EWorkerVars,
  type PaymentE2EProvider,
} from './payment-e2e-worker';

export async function runPaymentE2E(
  provider: PaymentE2EProvider,
  runtimeEnv: NodeJS.ProcessEnv
) {
  const env = {
    ...runtimeEnv,
    PAYMENT_E2E_PROVIDER: provider,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    PAYMENT_E2E_CONFIG_PATH: '',
  };
  getPaymentE2EWorkerVars(env);
  // A separate config directory prevents the developer's .dev.vars from
  // overriding sandbox credentials. Keep resource IDs and persistence intact.
  mkdirSync('.wrangler', { recursive: true });
  const directory = mkdtempSync(resolve('.wrangler/payment-e2e-'));
  try {
    const configPath = resolve(directory, 'wrangler.json');
    const config = parseWranglerConfig();
    config.main = resolve(String(config.main));
    for (const database of config.d1_databases ?? []) {
      if (database.migrations_dir) {
        database.migrations_dir = resolve(database.migrations_dir);
      }
    }
    env.PAYMENT_E2E_CONFIG_PATH = configPath;
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    const child = spawn(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--config',
        `playwright.${provider}.config.ts`,
        ...process.argv.slice(2).filter((argument) => argument !== '--'),
      ],
      { env, stdio: 'inherit' }
    );
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    try {
      return await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) =>
          resolve(code ?? (signal === 'SIGINT' ? 130 : 143))
        );
      });
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
