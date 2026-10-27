import { loadEnv } from 'vite';
import { runPaymentE2E } from './run-payment-e2e';

/**
 * Bootstrap for `pnpm e2e:creem`.
 *
 * Creem does not provide a local webhook-forwarding CLI. The Playwright
 * config starts the local E2E Worker automatically; the caller still needs
 * to expose its port with an HTTPS tunnel and register that URL as a Creem
 * test webhook before starting a paid flow.
 */

const port = Number(process.env.CREEM_E2E_PORT ?? 3021);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const fileEnv = loadEnv('e2e', process.cwd(), '');
const runtimeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...fileEnv,
  CREEM_DEBUG: 'true',
  PLAYWRIGHT_BASE_URL: baseURL,
  VITE_BASE_URL: baseURL,
  VITE_PAYMENT_PROVIDER: 'creem',
};

const requiredVariables = [
  'CREEM_API_KEY',
  'CREEM_WEBHOOK_SECRET',
  'VITE_CREEM_PRODUCT_PRO_MONTHLY',
  'VITE_CREEM_PRODUCT_PRO_YEARLY',
  'VITE_CREEM_PRODUCT_LIFETIME',
] as const;

for (const variable of requiredVariables) {
  if (!runtimeEnv[variable]) {
    throw new Error(`${variable} is required for Creem sandbox E2E`);
  }
}

if (runtimeEnv.CREEM_DEBUG !== 'true') {
  throw new Error(
    'Creem sandbox E2E requires CREEM_DEBUG=true and a test-mode API key'
  );
}

console.log('Creem E2E prerequisites (the local Worker starts automatically):');
console.log(`  1. HTTPS tunnel → http://localhost:${port}`);
console.log(
  `     (for example: cloudflared --config /dev/null tunnel --url http://localhost:${port} --no-autoupdate --protocol quic)`
);
console.log(
  '  2. Creem Dashboard Test Mode: webhook → <tunnel>/api/webhooks/creem'
);
console.log(
  '     subscribed to checkout.completed, subscription.active, subscription.paid, subscription.scheduled_cancel, subscription.canceled, subscription.expired, subscription.past_due, subscription.unpaid, subscription.trialing, subscription.paused'
);
console.log(`Playwright base URL: ${baseURL}`);
console.log('');

process.exitCode = await runPaymentE2E('creem', {
  ...runtimeEnv,
  PLAYWRIGHT_BASE_URL: baseURL,
  CREEM_E2E_PORT: String(port),
});
