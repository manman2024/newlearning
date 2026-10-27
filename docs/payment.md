# Payment (Stripe / Creem / Waffo)

Subscription and one-time payment support via a **provider pattern** — switch between Stripe, Creem, and Waffo by setting the `VITE_PAYMENT_PROVIDER` env var (`'stripe'`, `'creem'`, or `'waffo'`). Set it to `''` (empty, the default) to disable payment entirely. All providers implement the same `PaymentProvider` interface, so downstream code (checkout, billing, webhooks) remains provider-agnostic. See [Env](./env.md) for all variables.

### Shared routes

- **Pricing**: `/pricing` — plans and checkout buttons.
- **Payment callback**: `/settings/payment` — polls every two seconds for up to 60 seconds (`src/payment/constants.ts`), then redirects to `callback` (default `/settings/billing`). It accepts two forms of order-scoped reference:
  - **Session mode (Stripe)**: `/settings/payment?session_id={CHECKOUT_SESSION_ID}&callback=/settings/billing`. Stripe fills in the session ID; the page calls `checkPaymentCompletion` until the authenticated user's payment row for that session has `paid=true`.
  - **Hosted post-checkout mode (Creem, Waffo)**: `/settings/payment?checkout_id=<reference>&callback=%2Fsettings%2Fbilling`. The server creates a unique reference before checkout, sends it in provider metadata, and the webhook stores it in `payment.sessionId`. The page polls only that payment, so an older paid plan cannot complete a new checkout.
- **Billing**: `/settings/billing` — current plan and subscription management.

### Shared server API (Server Functions)

All functions in `src/api/payment.ts` use `authApiMiddleware`.

- `createCheckoutSession` — create a checkout session for the current user; returns `{ url, id }`. Adds `userId` and `userName` to the checkout metadata, plus a server-generated `paymentReference` for hosted post-checkout providers.
- `createCustomerPortalSession` — create a billing portal session: Stripe Customer Portal, Creem customer portal, or Waffo's shared consumer portal URL. Requires `user.customerId` unless the provider sets `requiresCustomerId = false` (Waffo).
- `getCurrentPlan` — current plan and subscription for the current user. A completed Lifetime payment wins over subscriptions; otherwise the latest `active`/`trialing` subscription; otherwise the free plan.
- `checkPaymentCompletion` — whether the current user's payment for a Stripe Checkout Session ID or hosted-provider order reference is paid.

Client-supplied Checkout success/cancel URLs and Customer Portal return URLs
are resolved against `VITE_BASE_URL`; request `Host` and `Origin` headers are
not trusted. Root-relative and canonical same-origin absolute URLs are
accepted. Protocol-relative URLs, backslash variants, subdomains, protocol
changes, and non-equivalent ports are rejected. Explicit default ports are
treated as the same origin. The payment page reduces an accepted callback to
an internal path before client navigation and falls back to Billing for an
unsafe callback. Payment completion lookups are scoped to both the Checkout
Session ID and the authenticated user.

### Checkout localization & theme

The checkout is always hosted by the payment provider, so language and theme follow each provider's own page:

- **Stripe** — the checkout locale is set from the site locale via the `locale` param (falls back to `auto`). Dark mode is not supported on Stripe's hosted checkout; only dashboard branding (logo, colors) applies.
- **Creem** — the checkout auto-detects the browser language (42 languages, switchable on the page); there is no locale parameter. The template appends the site's resolved theme as `?theme=dark|light` to the checkout URL; without it the store default theme is used.
- **Waffo** — the site locale is mapped to the checkout `language` (`en` → `en`, `zh` → `zh-Hans`; customers can still switch on the page) and the site's resolved theme is passed as `darkMode` (`true`/`false`, omit → store default).

### Module layout

| Path | Purpose |
|------|---------|
| `src/payment/types.ts` | `PaymentProvider` interface, shared types |
| `src/payment/index.ts` | Provider factory/registry, exported functions |
| `src/payment/constants.ts` | Payment callback polling interval and timeout |
| `src/payment/errors.ts` | `InvalidWebhookSignatureError` (mapped to `400` by the Stripe route) |
| `src/lib/payment-return-url.ts` | `normalizePaymentReturnUrl` for success/cancel/portal return URLs |
| `src/payment/provider/stripe.ts` | Stripe provider implementation |
| `src/payment/provider/creem.ts` | Creem provider implementation |
| `src/payment/provider/waffo.ts` | Waffo Pancake provider implementation |
| `src/api/payment.ts` | Server functions (provider-agnostic) |
| `src/lib/price-plan.ts` | Plan/price helpers from config |
| `src/config/website.ts` | `price.plans` and env-based price/product IDs |

---

## Stripe

### Setup

1. **Env**: Set the following environment variables (see [Env](./env.md)):
   - **Runtime (secrets):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - **Build-time:** `VITE_PAYMENT_PROVIDER=stripe`, `VITE_STRIPE_PRICE_PRO_MONTHLY`, `VITE_STRIPE_PRICE_PRO_YEARLY`, `VITE_STRIPE_PRICE_LIFETIME` (Stripe Price IDs)

2. **DB**: Schema adds `user.customerId` and `payment` table. Generate and apply migrations:
   - `pnpm db:generate`
   - Then apply with your D1 workflow (e.g. `pnpm db:migrate:remote` or `pnpm db:migrate:local`)

3. **Stripe Dashboard**:
   - Create Products/Prices for Pro (monthly/yearly) and Lifetime.
   - Webhook: `https://your-domain.com/api/webhooks/stripe`
     Events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `charge.refunded`.

### Payment confirmation and event ordering

`invoice.paid` is the authority for a successful Stripe payment. A completed
Checkout Session is useful payment context, but it does not set `payment.paid`
to `true`:

1. `checkout.session.completed` creates the subscription or Lifetime payment
   row with `paid=false`.
2. `invoice.paid` changes the row to `paid=true` and applies the latest
   subscription fields or Lifetime benefit.
3. The payment callback observes the row by Checkout Session ID and current
   user, then redirects to Billing.

Stripe does not guarantee delivery order. When `invoice.paid` arrives before
Checkout has created the local row, the same Invoice request reconstructs the
missing context instead of waiting in the webhook request:

- **Subscription:** read the Subscription referenced by the Invoice, then find
  its Checkout Session using the Subscription ID.
- **Lifetime:** retrieve the Invoice when necessary to obtain its PaymentIntent,
  then find the Checkout Session using the PaymentIntent ID. A fully discounted
  ($0) order has no PaymentIntent — Stripe omits it for no-cost orders — so the
  Session is instead matched by the customer and the Invoice it generated.

The recovered Session supplies the original `sessionId`, `userId`, and Price
metadata. The provider creates a complete `paid=true` row during that first
`invoice.paid` delivery, so the callback does not depend on a delayed Stripe
retry. Lifetime Checkout also copies the metadata onto its generated Invoice
for future event payloads.

Concurrent Checkout and Invoice handlers are expected. The Invoice transition
to paid wins an insert conflict, repeated deliveries do not create another
payment row, and a Lifetime notification is emitted only by the handler that
actually changes the row from unpaid to paid.

### Stripe webhook responses

The Stripe endpoint uses HTTP status codes to control provider retries:

| Result | Status | Meaning |
|---|---:|---|
| Successfully processed or safely duplicated | `200` | Stripe can stop delivering the event. |
| Missing payload/signature or invalid signature | `400` | The request cannot become valid by retrying. |
| Stripe is not the configured payment provider | `404` | The stale provider endpoint is inactive. |
| Temporary Stripe API, D1, or processing failure | `500` | Stripe should retry the event. |
| Payment is disabled (`VITE_PAYMENT_PROVIDER=''`) | `200` | The event is acknowledged and ignored. |

The handler does not poll D1 or sleep while processing a webhook. Provider
retries remain a recovery path for real transient failures, not the normal way
an out-of-order payment becomes visible.

See the [payment test catalog](../tests/e2e/TEST-CATALOG.md#stripe-payment-coverage)
for the event-order and HTTP test matrix. See the
[Stripe sandbox guide](../tests/e2e/stripe/README.md) for local Test Mode setup
and browser verification.

### Billing portal

Stripe provides a built-in **Customer Portal** for managing subscriptions (upgrade, cancel, update payment method). Accessed via the "Manage subscription" button on `/settings/billing`.

Full refunds for Lifetime purchases are handled through `charge.refunded` and
revoke only the payment matched by its Invoice or Checkout Session. The row is
marked `canceled`, so a delayed `invoice.paid` replay cannot restore access.
Partial refunds do not revoke access.

---

## Creem

[Creem](https://creem.io) is a merchant-of-record (MoR) payment platform. It handles global tax compliance, payouts, and provides a simpler setup compared to Stripe.

### Setup

1. **Env**: Set the following environment variables (see [Env](./env.md)):
   - **Runtime (secrets):** `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`
   - **Runtime (optional):** `CREEM_DEBUG=true` to use the Creem test/sandbox API (`test-api.creem.io`); omit or set to `false` for production (`api.creem.io`)
   - **Build-time:** `VITE_PAYMENT_PROVIDER=creem`, `VITE_CREEM_PRODUCT_PRO_MONTHLY`, `VITE_CREEM_PRODUCT_PRO_YEARLY`, `VITE_CREEM_PRODUCT_LIFETIME` (Creem Product IDs)

2. **DB**: Same schema as Stripe (`user.customerId`, `payment` table). Generate and apply migrations:
   - `pnpm db:generate`
   - Then apply with your D1 workflow (e.g. `pnpm db:migrate:remote` or `pnpm db:migrate:local`)

3. **Creem Dashboard**:
   - Create Products for Pro (monthly/yearly) and Lifetime.
   - Webhook: Settings → Webhooks → Add endpoint: `https://your-domain.com/api/webhooks/creem`
     Events handled by the provider: `checkout.completed`, `subscription.active`, `subscription.paid`, `subscription.update`, `subscription.trialing`, `subscription.scheduled_cancel`, `subscription.canceled`, `subscription.expired`, `subscription.past_due`, `subscription.unpaid`, `subscription.paused`. Other events are logged and ignored. `subscription.expired` remains recoverable and maps to `past_due`; only `subscription.canceled` is terminal. `subscription.unpaid` suspends access after collection attempts are exhausted.

### Key differences from Stripe

- Creem uses **Product IDs** (not Price IDs) for checkout.
- Creem is a **merchant of record** — it handles tax, VAT, and payouts on your behalf.
- Creem provides a **customer portal** for subscription management, similar to Stripe's Customer Portal.
- Debug/sandbox mode is toggled via the `CREEM_DEBUG` env var.
- Checkout returns through `/settings/payment?checkout_id=<reference>` and polls the payment row created for that specific order.
- **Refunds and disputes are not handled.** A Creem refund does not revoke access automatically; revoke it manually or add a handler in `src/payment/provider/creem.ts`.

### Creem webhook responses

| Result | Status |
|---|---:|
| Payment is disabled | `200` |
| Creem is not the configured payment provider | `404` |
| Missing payload or `creem-signature` header | `400` |
| Invalid signature | `400` |
| Processed | `200` |
| Processing failure (e.g. database unavailable) | `500` |

Only successfully processed events are acknowledged with `200`. Temporary
processing failures return `500` so Creem can retry the delivery. This includes
subscription lifecycle events that arrive before `checkout.completed` has
created their payment row. Handlers must remain idempotent because a
successfully processed event may also be delivered again. Signature failures
return `400` because retrying the same invalid request cannot make it valid.
Check the Worker logs for `Creem webhook error`.

## Waffo Pancake

[Waffo Pancake](https://docs.waffo.ai/integrate/ai-integration) is an external Merchant of Record payment platform supporting fixed-price SaaS subscriptions and one-time products. This template integration uses Waffo's hosted checkout and consumer portal.

### Setup

1. **Env**: Set the following variables:
   - **Runtime secrets:** `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY`
   - **Runtime (optional):** `WAFFO_DEBUG=true` to accept `mode: "test"` webhook events in a production build (useful when smoke-testing prod deployments with a sandbox merchant). Leave unset or `false` in real production so sandbox purchases can never grant real access.
   - **Build-time:** `VITE_PAYMENT_PROVIDER=waffo`, `VITE_WAFFO_PRODUCT_PRO_MONTHLY`, `VITE_WAFFO_PRODUCT_PRO_YEARLY`, `VITE_WAFFO_PRODUCT_LIFETIME` (Waffo Product IDs)
2. **Waffo Dashboard**:
   - Create one subscription product for each monthly/yearly plan and one one-time product for the lifetime plan.
   - Publish the products from test to production before using production checkout.
   - Configure the webhook URL as `https://your-domain.com/api/webhooks/waffo`.
   - Subscribe to `order.completed`, `subscription.activated`, `subscription.renewed`, `subscription.recovered`, `subscription.plan_changed`, `subscription.canceling`, `subscription.uncanceled`, `subscription.canceled`, `subscription.past_due`, `refund.succeeded`, and `refund.failed`. The setup helper uses this list by default. Existing endpoints must be edited in the Waffo dashboard to enable the new `subscription.renewed` event. `subscription.payment_succeeded` is a payment receipt event and is not used to update subscription state.
3. **Consumer portal**: The Billing page sends customers to Waffo's hosted portal at `https://pancake.waffo.ai/consumer/portal/login`. Customers use the purchase email and Waffo Magic Link flow to manage subscriptions and refund requests.

Keep `WAFFO_PRIVATE_KEY` server-only. For a PEM value in a Worker secret or local env file, preserve the PEM content with escaped `\n` line breaks as described in the Waffo SDK documentation.

### Notes and caveats

- **No `user.customerId`**: Waffo has no per-merchant customer entity, so unlike Stripe and Creem, this provider never writes `user.customerId`. The `payment.customerId` column stores the buyer identity for auditability: `merchantProvidedBuyerIdentity` from the webhook, falling back to the userId. At checkout the buyer identity is the userId (or the customer email if no userId is present). Any admin feature that assumes `user.customerId` is populated will silently no-op under Waffo.
- **Shared consumer portal**: `createCustomerPortal()` always returns the same `https://pancake.waffo.ai/consumer/portal/login` URL — no per-customer session is created. The provider declares `requiresCustomerId = false` so `src/api/payment.ts` skips the customerId guard for Waffo.
- **`sessionId` semantics**: Waffo does not return its `CHK_*` checkout session ID in webhook payloads. The server-generated `paymentReference` is therefore sent as `orderMerchantExternalId`, inherited by webhook events, and stored in `payment.sessionId`. Post-checkout redirects use `/settings/payment?checkout_id=<reference>` and poll that exact row.
- **Subscription periods**: `subscription.activated` stores the first period. `subscription.renewed` advances the current period, and `subscription.recovered` restores an active subscription after a successful retry. The shared payment row intentionally stores only the latest period; add a dedicated ledger if your product needs per-payment historical periods.
- **Plan changes**: `subscription.plan_changed` reads the new price from product metadata before falling back to the order metadata, which can still contain the original checkout price.
- **Refund policy**: Any successful `refund.succeeded` event revokes access (`paid = false`). This is stricter than Stripe, which only revokes on a full refund; Creem refunds are not handled at all. The Waffo payload has no partial-vs-full marker, so partial refunds intended to preserve access must be handled manually.
- **Trials**: No plan in `src/config/website.ts` sets `trialPeriodDays`, so the provider leaves `withTrial` unset and Waffo uses each product's own trial setting.

### Waffo webhook responses

| Result | Status |
|---|---:|
| Payment is disabled | `200` |
| Waffo is not the configured payment provider | `404` |
| Missing payload or `x-waffo-signature` header | `400` |
| Invalid signature, malformed header, or stale timestamp | `400` |
| Processed | `200` |
| Processing failure (e.g. database unavailable) | `500` |

As with Creem, only successfully processed events are acknowledged with `200`.
Temporary processing failures return `500` so Waffo can retry the delivery.
Lifecycle events that arrive before `subscription.activated` creates their
payment row are also retried instead of being acknowledged and lost. Handlers
must remain idempotent. Signature verification failures return `400` because
retrying the same invalid request cannot make it valid. Check the Worker logs
for `Waffo webhook error`.

### Waffo reference material

- [`docs/waffo/SKILL.md`](./waffo/SKILL.md) — vendor SDK guide for `@waffo/pancake-ts` in any TypeScript project. Where it differs from this template (webhook path, status codes, event list), this page and `src/payment/provider/waffo.ts` are authoritative.
- [`docs/resources/waffo-webhook-changes.md`](./resources/waffo-webhook-changes.md) — the 2026-09 Waffo notice about `subscription.renewed`; already implemented.
