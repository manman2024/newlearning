import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { getPaymentE2EWorkerVars } from './scripts/payment-e2e-worker';
import config from './vite.config';

// Credentials stay in memory; the runner removes its isolated config directory.
export default defineConfig(({ command, mode }) => {
  if (command !== 'serve' || mode !== 'e2e') {
    throw new Error('Payment E2E config only supports vite dev --mode e2e');
  }
  if (!process.env.PAYMENT_E2E_CONFIG_PATH) {
    throw new Error('Start payment E2E through pnpm e2e:<provider>');
  }
  const workerPlugins = cloudflare({
    persistState: process.env.E2E_PERSIST_PATH
      ? { path: process.env.E2E_PERSIST_PATH }
      : undefined,
    viteEnvironment: { name: 'ssr' },
    configPath: process.env.PAYMENT_E2E_CONFIG_PATH,
    config: { vars: getPaymentE2EWorkerVars(process.env) },
  });
  // Replace the Cloudflare plugin group without changing the shared config.
  let replaced = false;
  const plugins = config.plugins?.map((plugin) => {
    if (
      Array.isArray(plugin) &&
      plugin.some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          'name' in entry &&
          entry.name === 'vite-plugin-cloudflare'
      )
    ) {
      replaced = true;
      return workerPlugins;
    }
    return plugin;
  });
  if (!replaced) throw new Error('Cloudflare plugin group was not found');
  return { ...config, plugins };
});
