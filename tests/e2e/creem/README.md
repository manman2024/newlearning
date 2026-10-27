# Creem Test Mode payment testing

This directory contains the real Creem Test Mode browser flow in
`creem-sandbox.spec.ts`. It covers monthly and yearly subscriptions, the
Lifetime checkout, declined payments, webhook-backed D1 payment state, and
scheduled subscription cancellation.

Creem does not provide a local webhook-forwarding CLI in this workflow. Use an
HTTPS tunnel for the local webhook route and configure the endpoint in Creem
Test Mode.

## Manual local testing

The steps below use the normal local Worker on port `3000`. Do not mix Creem
Test Mode credentials or product IDs with production values.

### 1. Configure the local environment

Put the following values in the git-ignored `.env.local` file:

```dotenv
VITE_BASE_URL=http://localhost:3000
VITE_PAYMENT_PROVIDER=creem

CREEM_DEBUG=true
CREEM_API_KEY=...
CREEM_WEBHOOK_SECRET=...
VITE_CREEM_PRODUCT_PRO_MONTHLY=prod_...
VITE_CREEM_PRODUCT_PRO_YEARLY=prod_...
VITE_CREEM_PRODUCT_LIFETIME=prod_...
```

The product IDs must be Creem Test Mode products. `CREEM_WEBHOOK_SECRET` is
the signing secret for the Test Mode webhook endpoint configured below. If the
local D1 database has not been initialized, apply migrations:

```bash
pnpm db:migrate:local
```

### 2. Start the local Worker and a temporary HTTPS tunnel

Start the application:

```bash
pnpm dev
```

In a second terminal, use an isolated Cloudflared configuration if the machine
already has a Cloudflared setup:

```bash
cloudflared --config /dev/null tunnel \
  --url http://localhost:3000 \
  --no-autoupdate \
  --protocol quic
```

Copy the `https://....trycloudflare.com` URL printed by Cloudflared. The
`--config /dev/null` option prevents the command from reading an existing
`~/.cloudflared/config.yml`. Keep the tunnel running while testing.

### 3. Configure the Creem Test Mode webhook

In the Creem Dashboard, switch to Test Mode and add an HTTP webhook endpoint:

```text
https://xxxx.trycloudflare.com/api/webhooks/creem
```

Subscribe the endpoint to the events handled by this project:

- `checkout.completed`
- `subscription.active`
- `subscription.paid`
- `subscription.scheduled_cancel`
- `subscription.canceled`
- `subscription.expired`
- `subscription.past_due`
- `subscription.unpaid`
- `subscription.trialing`
- `subscription.paused`

Copy the endpoint signing secret into `CREEM_WEBHOOK_SECRET` and restart
`pnpm dev` if the value changed. The local route expects the raw request body
and the `creem-signature` header. If the temporary tunnel URL changes, update
the Dashboard endpoint and use the new URL.

### 4. Complete a hosted checkout

Open `http://localhost:3000/pricing`, register or sign in with a test account,
and choose a Creem product. Use these hosted-checkout test values:

| Field | Value |
|---|---|
| Cardholder name | The test user's name |
| Country | United States |
| Address | 123 Market Street |
| State | California |
| City | San Francisco |
| Postal code | 94105 |
| Successful card | `4242 4242 4242 4242` |
| Declined card | `4000 0000 0000 0002` |
| Expiry | Any future date, such as `12/30` |
| CVC | `123` |

For a successful payment, verify that:

1. Creem returns the browser through
   `/settings/payment?request_id=...`; the same reference is stored in the
   resulting D1 payment row before the page redirects to Billing.
2. The Worker receives `POST /api/webhooks/creem` with HTTP 200.
3. Billing shows the active monthly/yearly Pro plan or Lifetime access.
4. The local D1 payment row eventually contains the expected Creem product
   ID. Webhook delivery is asynchronous, so wait before retrying.

For the declined-card case, verify that the hosted checkout fails and no paid
payment row is created locally. Repeat successful checkout with the yearly
selector and with the Lifetime product.

### 5. Test scheduled cancellation

After completing a subscription, use the supported Creem cancellation flow or
the Creem Test Mode API to schedule cancellation. Confirm that the
`subscription.scheduled_cancel` webhook sets `cancelAtPeriodEnd=true` in D1
while the subscription remains active.

## Automated sandbox test

`pnpm e2e:creem` starts the isolated local Worker and D1 state automatically
through `playwright.creem.config.ts`. It does not start Cloudflared and does
not register the Creem Dashboard webhook automatically. The default E2E port
is `3021`.

Put the required sandbox variables in the git-ignored `.env.e2e` file or
export them in the shell:

```dotenv
VITE_BASE_URL=http://localhost:3021
VITE_PAYMENT_PROVIDER=creem
CREEM_DEBUG=true
CREEM_API_KEY=...
CREEM_WEBHOOK_SECRET=...
VITE_CREEM_PRODUCT_PRO_MONTHLY=prod_...
VITE_CREEM_PRODUCT_PRO_YEARLY=prod_...
VITE_CREEM_PRODUCT_LIFETIME=prod_...
```

Before running the paid flow, expose port `3021` and register the corresponding
`/api/webhooks/creem` URL in Creem Test Mode:

```bash
cloudflared --config /dev/null tunnel \
  --url http://localhost:3021 \
  --no-autoupdate \
  --protocol quic
```

Then run the suite:

```bash
pnpm e2e:creem
```

The runner creates a separate `.wrangler/e2e-creem-state` D1 state directory,
applies migrations, starts Vite in `e2e` mode, and runs the monthly, yearly,
Lifetime, declined-card, and scheduled-cancellation scenarios. To run a
subset:

```bash
pnpm e2e:creem -- --grep "monthly subscription"
```

Use `CREEM_E2E_PORT` to select another isolated port; the tunnel URL and
Dashboard webhook must target that same port.

## Troubleshooting

- The checkout uses the wrong product: verify `CREEM_DEBUG=true`,
  `VITE_PAYMENT_PROVIDER=creem`, and that the product IDs are from Creem Test
  Mode.
- Webhook signature verification fails: copy the secret from the current Creem
  Test Mode endpoint into `CREEM_WEBHOOK_SECRET` and restart the Worker.
- The automated runner cannot find credentials: ensure the required values are
  in `.env.e2e` or the shell environment.
- The browser succeeds but Billing does not update: keep the tunnel running,
  inspect Creem webhook delivery, and wait for asynchronous D1 processing.
- The webhook route returns 404: set `VITE_PAYMENT_PROVIDER=creem` and restart
  the local Worker.

Never commit `.env.local`, `.env.e2e`, Creem API keys, or webhook secrets.

## Worker environment isolation

The payment runner uses the shared `scripts/run-payment-e2e.ts` helper and
`vite.payment-e2e.config.ts`. Only the selected provider's credentials are
injected into the local Worker; the developer's `.dev.vars` is excluded.
Stripe uses the webhook secret returned by its listener. Temporary Worker
configuration is removed when Playwright exits, including failure or interruption.
Run the suite through `pnpm e2e:creem` rather than launching its
Playwright config directly.
