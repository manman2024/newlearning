# Waffo sandbox payment testing

This directory contains the real Waffo sandbox browser flow in
`waffo-sandbox.spec.ts`. It covers monthly and yearly hosted subscriptions,
the Lifetime checkout, the Waffo hosted confirmation page, webhook-backed D1
payment persistence, the accompanying pure payment event, and Billing updates
without a manual reload. Real period renewal remains unit-level because the
sandbox checkout journey creates a new subscription rather than advancing its
clock.

Waffo does not provide a local webhook-forwarding CLI for this workflow. The
local Worker must be exposed through an HTTPS tunnel, and the tunnel must
preserve the `X-Waffo-Signature` header. Do not use localtunnel because it
strips custom headers.

## Manual local testing

The steps below use the normal local Worker on port `3000`. Waffo uses Test
Mode automatically while the app runs in development.

### 1. Configure the local environment

Put the client configuration in the git-ignored `.env.local` file:

```dotenv
VITE_BASE_URL=http://localhost:3000
VITE_PAYMENT_PROVIDER=waffo
VITE_WAFFO_PRODUCT_PRO_MONTHLY=PROD_...
VITE_WAFFO_PRODUCT_PRO_YEARLY=PROD_...
VITE_WAFFO_PRODUCT_LIFETIME=PROD_...
```

Keep the server-only credentials available to the local Cloudflare Worker in
`.dev.vars` (or in the local process environment):

```dotenv
WAFFO_MERCHANT_ID=MER_...
WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

The products must belong to the Waffo sandbox store. `WAFFO_DEBUG=true` is
not required for local development; it is intended for accepting sandbox
webhooks in a production build. If the local D1 database has not been
initialized, apply the migrations:

```bash
pnpm db:migrate:local
```

### 2. Start the local Worker

```bash
pnpm dev
```

The local Waffo webhook endpoint is:

```text
http://localhost:3000/api/webhooks/waffo
```

### 3. Start an isolated Cloudflared tunnel

In a second terminal, expose port `3000` with a temporary HTTPS URL:

```bash
cloudflared --config /dev/null tunnel \
  --url http://localhost:3000 \
  --no-autoupdate \
  --protocol quic
```

Copy the `https://....trycloudflare.com` URL printed by Cloudflared. The
`--config /dev/null` option is intentional: it prevents Cloudflared from
reading an existing `~/.cloudflared/config.yml` or named-tunnel configuration.
Keep this terminal running for the entire checkout.

### 4. Register the Waffo Test Mode webhook

The setup helper requires an explicit Waffo store ID. Register the webhook
with:

```bash
pnpm tsx scripts/setup-waffo.ts \
  --store STO_xxx \
  --url https://xxxx.trycloudflare.com/api/webhooks/waffo
```

The helper registers Test Mode by default and subscribes to the order,
subscription, and refund events used by the provider. It is safe to rerun for
the same store, URL, channel, and mode. Use `--prod` only when intentionally
registering a production webhook.

For an endpoint created before `subscription.renewed` became available, open
it in the Waffo dashboard and explicitly enable that event. Registering code
changes alone cannot alter an already saved dashboard subscription list.

If the Waffo credentials exist only in `.dev.vars`, make them available to
the setup helper through `.env.local` or the shell as well; the helper reads
Vite's development env files and `process.env`, not the Worker binding file
directly. Never commit the private key.

Alternatively, create the same HTTP webhook manually in the Waffo dashboard's
Test Mode. Use this endpoint and preserve the raw body and signature header:

```text
https://xxxx.trycloudflare.com/api/webhooks/waffo
```

If the temporary URL changes, register the new URL again.

### 5. Complete a hosted checkout

Open `http://localhost:3000/pricing`, register or sign in with a test account,
and choose a Waffo product. On the hosted Waffo checkout:

1. For Pro, verify the free-trial label (e.g. `7-day free trial`) if your
   sandbox product has one configured, then click `Continue`. No plan in
   `src/config/website.ts` sets `trialPeriodDays`, so the trial length comes
   from the product's own setting in the Waffo dashboard.
2. Choose `Credit/Debit Card`.
3. Select the sandbox `Success` test option.
4. Click `Subscribe` for Pro or `Pay` for Lifetime.
5. Click `Done` on Waffo's confirmation page.
6. Wait for `/settings/payment?checkout_id=...` to poll the matching
   webhook-backed payment row and return to Billing.

Verify that:

1. The Cloudflared terminal remains connected and the local Worker receives a
   `POST` to `/api/webhooks/waffo`.
2. The request keeps the `X-Waffo-Signature` header and the route responds with
   HTTP 200.
3. Billing shows Pro + Active or Lifetime access without a manual reload.
4. The subscription interval is monthly or yearly as selected.
5. The local D1 payment row is eventually marked paid.

Waffo Test Mode also emits the pure payment event
`subscription.payment_succeeded` after `subscription.activated`. Keep the
Worker and tunnel running for a few seconds and verify that it does not create
a duplicate payment row or overwrite subscription lifecycle state.

## Automated sandbox test

`pnpm e2e:waffo` validates the required Waffo environment and launches the
Playwright suite with an isolated local Worker. It does **not** start
Cloudflared or register the Waffo webhook. The default E2E port is `3018`.

Put the required sandbox variables in the git-ignored `.env.e2e` file or export
them in the shell. The runner reads the `e2e` Vite environment:

```dotenv
VITE_BASE_URL=http://localhost:3018
VITE_PAYMENT_PROVIDER=waffo
VITE_WAFFO_PRODUCT_PRO_MONTHLY=PROD_...
VITE_WAFFO_PRODUCT_PRO_YEARLY=PROD_...
VITE_WAFFO_PRODUCT_LIFETIME=PROD_...
WAFFO_MERCHANT_ID=MER_...
WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Start the isolated tunnel before launching the suite. It can connect before
Playwright starts the local Worker:

```bash
cloudflared --config /dev/null tunnel \
  --url http://localhost:3018 \
  --no-autoupdate \
  --protocol quic
```

Register the tunnel URL as a Waffo Test Mode webhook with the same
`--store STO_xxx` command shown above, then run:

```bash
pnpm e2e:waffo
```

The suite covers monthly and yearly subscriptions (trial if the sandbox
product enables one), Lifetime checkout, webhook-backed Billing state, and
the accompanying payment event. To run one scenario:

Waffo sandbox payment processing and webhook delivery can take several
minutes. The suite keeps each test user until the hosted success page and
webhook-backed payment row have both completed.

```bash
pnpm e2e:waffo -- --grep "monthly subscription"
```

Use `WAFFO_E2E_PORT` and `PLAYWRIGHT_BASE_URL` together to select another
port; the Worker, tunnel, webhook URL, and Playwright base URL must all use the
same port:

```bash
WAFFO_E2E_PORT=3028 \
  PLAYWRIGHT_BASE_URL=http://localhost:3028 \
  pnpm e2e:waffo
```

## Troubleshooting

- The webhook route returns 404: set `VITE_PAYMENT_PROVIDER=waffo` and
  restart the Worker.
- Waffo reports an invalid or missing signature: use Cloudflared or another
  HTTPS tunnel that preserves `X-Waffo-Signature`; do not use localtunnel.
- The setup helper reports a missing store: pass `--store STO_xxx`; the helper
  does not auto-discover a store.
- The runner cannot find Waffo credentials: put them in `.env.e2e` or export
  them. `.dev.vars` alone is not loaded by `scripts/run-waffo-e2e.ts`.
- Checkout succeeds but Billing stays unchanged: keep the Worker and tunnel
  running, verify the webhook is registered in Test Mode, and wait for the
  asynchronous event delivery.
- A new `trycloudflare.com` URL no longer works: rerun the setup helper with
  the new URL and the `/api/webhooks/waffo` suffix.

Never commit `.env.local`, `.env.e2e`, `.dev.vars`, or the Waffo private key.

## Worker environment isolation

The payment runner uses the shared `scripts/run-payment-e2e.ts` helper and
`vite.payment-e2e.config.ts`. Only the selected provider's credentials are
injected into the local Worker; the developer's `.dev.vars` is excluded.
Stripe uses the webhook secret returned by its listener. Temporary Worker
configuration is removed when Playwright exits, including failure or interruption.
Run the suite through `pnpm e2e:waffo` rather than launching its
Playwright config directly.
