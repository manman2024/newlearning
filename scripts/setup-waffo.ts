import { WaffoPancake, WebhookEventType } from '@waffo/pancake-ts';
import { loadEnv } from 'vite';

/**
 * One-off Waffo webhook setup helper.
 *
 * Usage:
 *   pnpm tsx scripts/setup-waffo.ts --store <STORE_ID> --url <WEBHOOK_URL> \
 *     [--events order.completed,subscription.activated,...] \
 *     [--prod]
 *
 * Registers an HTTP webhook against the given Waffo store, subscribing to
 * the payment events this template listens for. Uses test mode by default;
 * pass --prod to register the production webhook. Run once per environment
 * per store — Waffo dedups per (store, channel, url, testMode) tuple, so
 * re-running with the same URL is safe.
 *
 * Requires WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY in .env / .env.local /
 * .env.e2e. See docs/waffo/SKILL.md → Configuring Webhook URLs.
 */

const DEFAULT_EVENTS: `${WebhookEventType}`[] = [
  WebhookEventType.OrderCompleted,
  WebhookEventType.SubscriptionActivated,
  WebhookEventType.SubscriptionRenewed,
  WebhookEventType.SubscriptionRecovered,
  WebhookEventType.SubscriptionPlanChanged,
  WebhookEventType.SubscriptionCanceling,
  WebhookEventType.SubscriptionUncanceled,
  WebhookEventType.SubscriptionCanceled,
  WebhookEventType.SubscriptionPastDue,
  WebhookEventType.RefundSucceeded,
  WebhookEventType.RefundFailed,
];

function readArg(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const storeId = readArg('store') ?? process.env.WAFFO_STORE_ID;
const url = readArg('url');
const eventsArg = readArg('events');
const isProd = hasFlag('prod');

if (!storeId) {
  throw new Error('Missing --store <STORE_ID> (or set WAFFO_STORE_ID)');
}
if (!url) {
  throw new Error('Missing --url <WEBHOOK_URL>');
}

const fileEnv = loadEnv('development', process.cwd(), '');
const runtimeEnv = { ...fileEnv, ...process.env };
const merchantId = runtimeEnv.WAFFO_MERCHANT_ID;
const privateKey = runtimeEnv.WAFFO_PRIVATE_KEY;

if (!merchantId) throw new Error('WAFFO_MERCHANT_ID is not set');
if (!privateKey) throw new Error('WAFFO_PRIVATE_KEY is not set');

const events = eventsArg
  ? (eventsArg.split(',').map((s) => s.trim()) as `${WebhookEventType}`[])
  : DEFAULT_EVENTS;
const client = new WaffoPancake({ merchantId, privateKey });

const result = await client.webhooks.add({
  storeId,
  channel: 'http',
  url,
  events,
  testMode: !isProd,
});

console.log(
  `Registered Waffo ${isProd ? 'production' : 'test'} webhook ${result.webhook.id}`
);
console.log(`  store:  ${storeId}`);
console.log(`  url:    ${url}`);
console.log(`  events: ${events.join(', ')}`);
