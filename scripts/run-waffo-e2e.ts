import { loadEnv } from 'vite';
import { runPaymentE2E } from './run-payment-e2e';

/**
 * Bootstrap for `pnpm e2e:waffo`.
 *
 * Waffo has no official CLI that forwards webhooks (unlike Stripe), so this
 * script validates the required env and launches Playwright, which starts an
 * isolated local Worker automatically. The caller is responsible for:
 *
 *   1. Exposing port ${port} via **cloudflared** — it preserves the
 *      `X-Waffo-Signature` header, needs no signup, and has no 2-hour
 *      session cap. ngrok also works but requires an account.
 *      Do NOT use localtunnel: it strips custom headers.
 *   2. Registering the tunnel URL as an HTTP test webhook in the Waffo
 *      dashboard (see docs/waffo/SKILL.md → Configuring Webhook URLs, or
 *      `scripts/setup-waffo.ts`).
 */

const port = Number(process.env.WAFFO_E2E_PORT ?? 3018);
// Better Auth rejects `127.0.0.1` origins; always use `localhost` so the
// default flow works without overriding PLAYWRIGHT_BASE_URL.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const fileEnv = loadEnv('e2e', process.cwd(), '');
const runtimeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...fileEnv,
  VITE_PAYMENT_PROVIDER: 'waffo',
};

const requiredVariables = [
  'WAFFO_MERCHANT_ID',
  'WAFFO_PRIVATE_KEY',
  'VITE_WAFFO_PRODUCT_PRO_MONTHLY',
  'VITE_WAFFO_PRODUCT_PRO_YEARLY',
  'VITE_WAFFO_PRODUCT_LIFETIME',
] as const;

for (const variable of requiredVariables) {
  if (!runtimeEnv[variable]) {
    throw new Error(`${variable} is required for Waffo sandbox E2E`);
  }
}

console.log('Waffo E2E prerequisites (the local Worker starts automatically):');
console.log(`  1. cloudflared tunnel pointing at localhost:${port}`);
console.log(`     (\`cloudflared tunnel --url http://localhost:${port}\`)`);
console.log(
  '  2. Waffo dashboard: HTTP test webhook → <tunnel>/api/webhooks/waffo'
);
console.log('     subscribed to order.completed + subscription.* + refund.*');
console.log(`Playwright base URL: ${baseURL}`);
console.log('');

process.exitCode = await runPaymentE2E('waffo', {
  ...runtimeEnv,
  PLAYWRIGHT_BASE_URL: baseURL,
  WAFFO_E2E_PORT: String(port),
});
