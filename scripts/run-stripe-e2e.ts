import { spawn, type ChildProcess } from 'node:child_process';
import { loadEnv } from 'vite';
import { runPaymentE2E } from './run-payment-e2e';

const port = Number(process.env.STRIPE_E2E_PORT ?? 3019);
const baseURL = `http://127.0.0.1:${port}`;
const fileEnv = loadEnv('e2e', process.cwd(), '');
const runtimeEnv = { ...process.env, ...fileEnv };
const defaultEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'charge.refunded',
];
const events = runtimeEnv.STRIPE_E2E_EVENTS
  ? runtimeEnv.STRIPE_E2E_EVENTS.split(',')
      .map((event) => event.trim())
      .filter(Boolean)
  : defaultEvents;
const requiredVariables = [
  'STRIPE_SECRET_KEY',
  'VITE_STRIPE_PRICE_PRO_MONTHLY',
  'VITE_STRIPE_PRICE_PRO_YEARLY',
  'VITE_STRIPE_PRICE_LIFETIME',
] as const;

for (const variable of requiredVariables) {
  if (!runtimeEnv[variable]) {
    throw new Error(`${variable} is required for Stripe sandbox E2E`);
  }
}

if (!runtimeEnv.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('Stripe sandbox E2E refuses to run without an sk_test_ key');
}

const listener = spawn(
  'stripe',
  [
    'listen',
    '--skip-update',
    '--events',
    events.join(','),
    '--forward-to',
    `${baseURL}/api/webhooks/stripe`,
  ],
  {
    env: {
      ...runtimeEnv,
      STRIPE_API_KEY: runtimeEnv.STRIPE_SECRET_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let stopped = false;

function stopListener() {
  if (stopped) return;
  stopped = true;
  listener.kill('SIGINT');
}

function sanitizedOutput(chunk: Buffer) {
  return chunk
    .toString()
    .replace(/whsec_[A-Za-z0-9_]+/g, '[redacted-webhook-secret]');
}

function waitForWebhookSecret(child: ChildProcess) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Stripe CLI webhook secret'));
    }, 30_000);
    let settled = false;

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/whsec_[A-Za-z0-9_]+/);
      process.stdout.write(sanitizedOutput(chunk));
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Stripe CLI listener exited early with code ${code}`));
    });
  });
}

async function run() {
  const webhookSecret = await waitForWebhookSecret(listener);
  console.log('Stripe sandbox listener is ready');

  process.exitCode = await runPaymentE2E('stripe', {
    ...runtimeEnv,
    PLAYWRIGHT_BASE_URL: baseURL,
    STRIPE_E2E_PORT: String(port),
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
}

process.once('SIGINT', () => {
  stopListener();
  process.exitCode = 130;
});
process.once('SIGTERM', () => {
  stopListener();
  process.exitCode = 143;
});

try {
  await run();
} finally {
  stopListener();
}
