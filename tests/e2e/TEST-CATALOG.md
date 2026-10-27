# E2E Test Catalog

This catalog is the acceptance checklist for Playwright E2E coverage. Update it
before or alongside changes to a user journey or behavioral contract, then use
the implemented spec files to lock in the verified behavior. Do not update it
for presentation-only changes.

## Workflow

Use the local feature flow:

```txt
Spec -> Code -> Verify -> Test -> Green
```

1. Spec: add or update the relevant journey in this catalog.
2. Code: implement the feature.
3. Verify: run the app and walk the real UI in a browser.
4. Test: add or update the matching Playwright spec.
5. Green: run the related spec locally; run full E2E before releases or large
   refactors.

## Test Intent

E2E coverage validates functional journeys and outcomes, not presentation
contracts. Use stable `data-testid` values for app-owned controls and durable
attributes for forms, routes, and generated data. Assert navigation, HTTP/API
results, persistence, permissions, and controls required to complete a journey.
Do not assert wording, layout, dimensions, colors, typography, icons, images,
CSS classes, or other visual styling in functional E2E tests.

E2E tests are intentionally local-first. CI should continue to prefer fast
checks such as `pnpm lint` and `pnpm test` unless a separate E2E environment is
explicitly provisioned.

## Test Harness

- Config: `playwright.config.ts`
- Specs: `tests/e2e/specs/`
- Fixtures: `tests/e2e/fixtures/`
- Test-only API: `src/routes/api/e2e/users.ts`
- Local state: `.wrangler/e2e-state/` (recreated for every run)

Playwright starts Vite on the configured `PORT` and points both Wrangler
migrations and the Cloudflare Vite plugin at the same isolated local state.
This keeps E2E data separate from the developer's `.wrangler/state` database.
`pnpm check` runs lint, unit tests (including locale generation), the production
build, type checking, and the local E2E suite.
`pnpm check:production` (also available as `pnpm e2e:production`) separately
builds the app and runs a smaller smoke suite against local Cloudflare Vite preview so production SSR and API output are covered too.
It does not deploy the application or test a live site.

The test-only API is disabled unless Vite is running locally with
`import.meta.env.DEV === true`, `MODE=e2e`, and the request includes the
configured `x-e2e-secret` header. Test accounts must use the
`e2e-*@example.test` email pattern so cleanup stays scoped.

## 1. Public Page Smoke Test

**File:** `specs/public-pages.spec.ts` | **Priority:** P0

Verifies that public routes load in English and Chinese without browser console
errors or page errors.

| # | Test name | Flow |
|---|---|---|
| 1 | Public pages render successfully | Open `/`, `/pricing`, `/blog`, `/blog/getting-started`, `/ai`, `/about`, `/contact`, `/changelog`, `/roadmap`, `/waitlist`, `/cookie`, `/privacy`, `/terms`, `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` for `en` and `zh`. Verify each returns 2xx, renders a document body, and emits no browser errors. |
| 1a | Localized content indexing | Blog and legal documents use each available translation as canonical and reciprocal hreflang; sitemap lists each available URL. Missing translations are omitted from sitemap/alternates, and explicit unavailable language URLs redirect to a real version while preserving the query. |
| 2 | Home login modal opens | Open `/`, click the navbar login button, verify the login dialog and credential inputs are visible, and assert no browser errors. |
| 3 | Mobile auth actions avoid hydration errors | Open the mobile navigation, verify its login and registration controls are usable, assert that it emits no nested-button hydration error, then verify the login control routes to `/auth/login`. |
| 4 | Health check responds with pong | Call `/api/ping` and verify `{ "message": "pong" }`. |

## 2. Authentication And Protected Routes

**File:** `specs/auth.spec.ts` | **Priority:** P0

Verifies login and route protection with real Better Auth endpoints and seeded
verified users.

| # | Test name | Flow |
|---|---|---|
| 1 | Guests are redirected from dashboard | Open `/dashboard` while signed out, expect redirect to `/auth/login`, and verify the email input is visible. |
| 2 | Verified user can sign in | Create an E2E user, mark it verified, sign in through `/auth/login`, and verify dashboard content. |
| 3 | User can register from UI | Fill `/auth/register`, verify the signup request succeeds, mark the test account verified, sign in through `/auth/login`, and verify navigation to the dashboard. |
| 4 | Short registration password is rejected locally | Fill a seven-character password and verify the browser blocks submission before it requests `/api/auth/sign-up/email`. |
| 5 | Non-admin cannot view admin pages | Sign in as a non-admin user, open `/admin/users`, and expect redirect to `/dashboard`. |
| 6 | Admin can view users dashboard | Sign in as an admin E2E user, open `/admin/users`, verify the users dashboard shows the admin email, then open and close the user's detail drawer. |

### Customer Mapping Protection

**File:** `specs/auth-customer-id.spec.ts` | **Priority:** P0

| # | Test name | Flow |
|---|---|---|
| 1 | Registration cannot inject a customer ID | Submit another customer's ID to the real signup endpoint, verify rejection and no persisted account, then register normally with the same email. |
| 2 | Profile updates cannot replace a customer ID | Seed distinct server-owned customer IDs for two users, sign in, attempt to replace the current user's ID through cookie and bearer authentication, and verify both D1 mappings remain unchanged. |
| 3 | Empty values cannot clear a customer ID | Submit null and empty-string customer IDs alongside valid name updates; verify the names persist while the original D1 customer mapping remains intact. |

Normal registration, login, and profile editing remain covered by `auth.spec.ts`
and `settings-profile.spec.ts`. Provider and portal unit tests use mocked payment
services; these journeys do not require a hosted checkout or real customer IDs.

## 3. Protected Page Smoke Test

**File:** `specs/protected-pages.spec.ts` | **Priority:** P0

Verifies authenticated app routes load in English and Chinese without browser
console errors or page errors.

| # | Test name | Flow |
|---|---|---|
| 1 | Protected pages render successfully | Sign in as an admin E2E user, then open `/dashboard`, `/admin/users`, `/settings/profile`, `/settings/security`, `/settings/apikeys`, `/settings/files`, `/settings/billing`, `/settings/payment`, `/settings/notifications` for `en` and `zh`. Verify each returns 2xx, renders a document body, and emits no browser errors. |
| 2 | Collapsed sidebar persists across protected route groups | Collapse the desktop sidebar, navigate from Dashboard to Profile and Security, then return to Dashboard. Verify the sidebar remains collapsed after every route transition. |

### Admin user search

**File:** `specs/admin-users-search.spec.ts` | **Priority:** P1

An admin searches seeded names containing `_`, `%`, and backslashes, then
searches by email. Verify matching users appear and wildcard-like decoys do not.
Verify ordinary case-insensitive substring search still works.

## 4. Profile Settings

### Newsletter ownership

**File:** `tests/unit/newsletter-security.test.ts` | **Priority:** P0

Subscription status and unsubscribe require a verified session. Client-supplied
email addresses cannot select another user's subscription; operations and cache
invalidation use the authenticated user's database email.

### MailCheap newsletter provider

**Files:** `tests/unit/newsletter-mailcheap.test.ts`, `tests/unit/newsletter-provider.test.ts`, `tests/unit/newsletter-mailcheap-redirects.test.ts` | **Priority:** P1

Selecting `mailcheap` uses the existing newsletter module for signup, status and
unsubscribe. Requests stay scoped to the configured newsletter; signup supports
re-subscription, only active contacts count as subscribed, and a missing contact
can be unsubscribed successfully. Provider failures return false without exposing
credentials or remote response bodies. Reads may retry once; writes never retry.
Non-JSON error responses retain their HTTP status semantics. Disabled newsletters
and existing providers do not require MailCheap credentials.
Provider API tests use mocks. Redirect tests use a local HTTP server and native
`fetch`: reads follow 301/302/303/307/308; writes preserve their method and body
through 307/308. No test contacts the live provider or establishes mail delivery.

**File:** `specs/settings-profile.spec.ts` | **Priority:** P1

Verifies the signed-in profile update flow.

| # | Test name | Flow |
|---|---|---|
| 1 | User can update display name | Sign in, open `/settings/profile`, change the name, save, reload, and verify persistence. |

## 5. API Key Settings

**File:** `specs/settings-apikeys.spec.ts` | **Priority:** P0

Verifies the Better Auth API key lifecycle through the signed-in UI.

| # | Test name | Flow |
|---|---|---|
| 1 | User can create and delete an API key | Sign in, create a named API key, verify the one-time secret and persisted table row, delete it, and verify the row disappears. |

## 6. Security Settings

**File:** `specs/settings-security.spec.ts` | **Priority:** P0

Verifies credential changes through Better Auth and the real browser session.

| # | Test name | Flow |
|---|---|---|
| 1 | User can change password | Sign in, change the password, sign out, verify the old password is rejected, then sign in with the new password. |

## 7. File Settings

**File:** `specs/settings-files.spec.ts` | **Priority:** P0

Verifies the D1 and R2 file lifecycle through the signed-in UI and same-origin
download endpoint, including TanStack Server Function CSRF protection.

| # | Test name | Flow |
|---|---|---|
| 1 | User can upload, read, and delete a private file | Sign in, upload a text file, verify its table row and authenticated response headers/body, replay the upload request from a cross-site origin and verify a 403 response, delete the file, and verify the row disappears. |

## 8. Production Worker Smoke Test

**File:** `production/production-smoke.spec.ts` | **Priority:** P0

Verifies the built Worker rather than the Vite development server.

| # | Test name | Flow |
|---|---|---|
| 1 | Production Worker serves SSR and API responses | Build the app, start Cloudflare Vite preview, render and hydrate representative public routes, verify guest auth redirect and `/api/ping`, and confirm the E2E helper returns 404. |

## 9. Router Boundaries

**File:** `specs/router-boundaries.spec.ts` | **Priority:** P0

Verifies TanStack Router error handling at the HTTP and rendered UI boundaries.

| # | Test name | Flow |
|---|---|---|
| 1 | Unknown route renders not found | Open an unknown route, verify HTTP 404 and the root not-found UI. |
| 2 | Loader notFound renders root boundary | Open `/test-404`, verify HTTP 404 and the root not-found UI. |
| 3 | Loader error renders catch boundary | Open `/test-error` and verify the HTTP 500 catch boundary is rendered. |

## Deferred Coverage

These flows should be added after their dependencies are made deterministic:

| Area | Reason |
|---|---|
| Transactional email | Requires a fake mail provider or captured verification links. |
| AI tools | Requires provider mocks or stable fake responses to avoid cost and flake. |

## Stripe Payment Coverage

Stripe payment tests use two layers. Creem has a separate hosted-checkout
sandbox suite below because its webhook forwarding and hosted UI differ from
Stripe.

### Fast webhook layer

**Files:** `tests/unit/payment/stripe-webhook.test.ts`,
`tests/unit/payment/stripe-provider.test.ts`, and
`tests/unit/payment/stripe-webhook-route.test.ts`

Runs inside `pnpm test` with Stripe SDK-generated test signatures. It verifies
invalid signatures, checkout creation for subscription and Lifetime prices,
Customer Portal parameters, subscription and one-time `invoice.paid` handling,
renewal lookup by subscription ID, cancellation/deletion, refund access
revocation, and duplicate payment idempotency without making network requests.
The event-order matrix covers Checkout-first, subscription Invoice-first,
Lifetime Invoice-first, Checkout arriving after reconstruction, and a concurrent
insert conflict. Checkout always creates an unpaid row; only `invoice.paid`
makes the row paid. Invoice-first recovery obtains the original Checkout Session
and persists its `sessionId`, so the payment result page can observe success on
the first delivery without waiting for a Stripe retry.
The HTTP route boundary returns 400 for invalid signatures, 500 for retryable
processing failures, and 200 for successful or safely duplicated deliveries;
it also verifies that later Stripe retries can succeed after temporary D1 or
Stripe API failures.

The provider-independent server boundary is covered by
`tests/unit/payment/payment-security.test.ts`. It rejects external Checkout and
Customer Portal return URLs, normalizes root-relative and same-origin absolute
URLs against the configured application origin, and verifies that a paid
Checkout Session is visible only to its owner while foreign, forged, and
missing Session IDs remain unpaid. Protocol-relative and backslash variants,
subdomains, protocol changes, and non-equivalent ports are rejected. The
payment page reduces an accepted callback to an internal path and falls back to
Billing for an unsafe callback.

### Sandbox E2E layer

**File:** `tests/e2e/stripe/stripe-sandbox.spec.ts`

Run explicitly with `pnpm e2e:stripe`. The runner refuses live keys, starts a
Stripe CLI listener, forwards real sandbox events to the local Worker, and uses
Playwright to complete hosted Checkout with Stripe's success and decline test
cards. Successful flows poll the local E2E API and assert the D1 payment row
instead of relying on rendered Billing text.

| # | Test name | Flow |
|---|---|---|
| 1 | Monthly subscription and portal plan changes | Register and sign in, create a real monthly Checkout Session, complete sandbox Checkout, verify the D1 subscription row and Stripe subscription price, then use Customer Portal to switch monthly → yearly → monthly and verify the Stripe Subscription plus D1 price, interval, and billing period after each change. |
| 2 | Yearly subscription | Register and sign in, select yearly pricing, complete sandbox Checkout, and verify the D1 interval/status and yearly Stripe price. |
| 3 | Lifetime payment | Register and sign in, complete a one-time sandbox Checkout, and verify the paid Lifetime D1 row and Stripe line-item price. |
| 4 | Zero-cost Lifetime payment | Create a temporary one-use 100% promotion code, complete hosted Checkout, verify the Session and Invoice are paid with zero amount and no PaymentIntent, and verify `invoice.paid` creates the paid Lifetime D1 row. The focused command forwards only `invoice.paid` to force reconstruction without Checkout persistence. |
| 5 | Declined card | Submit Stripe's decline test card and verify the checkout remains unsuccessful with no paid D1 row. |
| 6 | Cancellation and deletion | Cancel at period end, then cancel immediately through the Stripe API and verify both subscription webhook states in D1. |
| 7 | Full refund | Refund the Lifetime PaymentIntent and verify the `charge.refunded` webhook revokes access. |

Renewal lookup and period updates are covered in the fast provider tests with
signed `invoice.paid` events. The sandbox suite does not cover failed
renewals/past-due recovery, time-based Test Clock advancement, or Customer
Portal payment method replacement.

## Creem Payment Coverage

**File:** `tests/e2e/creem/creem-sandbox.spec.ts` | **Priority:** P1

Run the focused suite with `pnpm e2e:creem`. The suite uses Creem Test Mode
products and test cards, then verifies both the hosted browser journey and the
asynchronous webhook-backed D1 payment row.

| # | Test name | Flow |
|---|---|---|
| 1 | Monthly subscription | Register and sign in, complete the Creem hosted monthly checkout, return through the app payment-processing route, and verify Pro + Active plus the monthly product in D1. |
| 2 | Yearly subscription | Select yearly pricing, complete the hosted checkout, and verify Pro + Active plus the yearly product and interval in D1. |
| 3 | Lifetime payment | Complete the hosted one-time checkout and verify Lifetime plus a completed one-time D1 payment row. |
| 4 | Declined card | Submit Creem's declined test card and verify the checkout stays unsuccessful with no paid D1 row. |
| 5 | Scheduled cancellation | Cancel the created test subscription through Creem's official SDK/API and verify the `subscription.scheduled_cancel` webhook sets `cancelAtPeriodEnd` while the subscription remains active. |

### Prerequisites

`pnpm e2e:creem` starts the local Worker and isolated D1 state automatically.
Before running it, configure the following in Creem Test Mode:

1. Expose `http://localhost:3021` through an HTTPS tunnel. Creem's webhook
   documentation recommends a public HTTPS endpoint for local testing; for
   example, use `cloudflared --config /dev/null tunnel --url
   http://localhost:3021 --no-autoupdate --protocol quic`.
2. Register `<tunnel>/api/webhooks/creem` under the Creem Test Mode Developers
   → Webhooks page, with the events used by the suite:
   `checkout.completed`, `subscription.active`, `subscription.paid`,
   `subscription.scheduled_cancel`, `subscription.canceled`,
   `subscription.expired`, `subscription.past_due`, `subscription.unpaid`,
   `subscription.trialing`, and `subscription.paused`.
3. Set `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_DEBUG=true`, and the
   three `VITE_CREEM_PRODUCT_*` test product IDs.

Creem's test cards accept any future expiry, CVV, and billing details. The
successful card is `4242 4242 4242 4242`; the declined card is
`4000 0000 0000 0002`. Webhook delivery is asynchronous, so the tests wait
for the local E2E API before deleting each test user.

The suite does not cover test-mode renewal time travel, refunds, or interactive
customer portal changes. Those should remain separate because Creem's portal
uses an email magic-link flow and its renewal lifecycle is time-dependent.

## Waffo Payment Coverage

**File:** `tests/e2e/waffo/waffo-sandbox.spec.ts` | **Priority:** P1

Run the focused suite with `pnpm e2e:waffo`. The unit boundary
(`tests/unit/payment/waffo-provider.test.ts`) already runs in `pnpm test` and
covers checkout mapping, order completion, subscription lifecycle changes,
renewal period advancement, and refund handling.

The Playwright journey registers and signs in, completes Waffo test checkout
for the monthly, yearly and lifetime products, verifies the corresponding D1
payment and subscription state, and verifies the pure payment event
(`subscription.payment_succeeded`) does not overwrite subscription lifecycle
state or create duplicate rows.

Hosted checkouts return through the payment processing page with an
order-scoped reference (`/settings/payment?checkout_id=...`). The webhook stores
the same reference in `payment.sessionId`, so the page polls only the payment
created by that checkout before navigating to Billing. The specs assert that
route transition and the resulting database state without coupling the flow to
Billing-page copy.

Waffo test mode delivers `subscription.payment_succeeded` alongside the first
payment's `subscription.activated` event. The dedicated state test asserts
that this payment-only event leaves the activated subscription row unchanged
and creates no duplicate payment rows. Actual period advancement is carried
by `subscription.renewed` and covered at the provider boundary.

### Prerequisites

`pnpm e2e:waffo` runs `scripts/run-waffo-e2e.ts`, which validates the
required env vars and launches Playwright. It does **not** start the server
or the tunnel; set these up manually before running:

1. Local dev server in E2E mode on port `3018`. The `dev` script hardcodes
   port 3000, so start Vite directly:

   ```bash
   pnpm exec vite dev --mode e2e --host localhost --port 3018 --strictPort
   ```

   Vite's `--mode e2e` is what enables the E2E helper route in
   `src/routes/api/e2e/users.ts` (the `x-e2e-secret` header must match).
2. Public tunnel to `http://localhost:3018` via **cloudflared**:

   ```bash
   cloudflared --config /dev/null tunnel \
     --url http://localhost:3018 \
     --no-autoupdate \
     --protocol quic
   ```

   It preserves the `X-Waffo-Signature` header, needs no account, and has no
   2-hour session cap. ngrok works too but requires signup. Do **not** use
   localtunnel — it strips custom headers, so Waffo webhook signature
   verification fails.
3. Waffo dashboard configured with:
   - test-mode products for the monthly / yearly / lifetime plans, with
     their IDs in `VITE_WAFFO_PRODUCT_PRO_MONTHLY`,
     `VITE_WAFFO_PRODUCT_PRO_YEARLY`, and `VITE_WAFFO_PRODUCT_LIFETIME`,
   - an `http` webhook pointing at `<tunnel>/api/webhooks/waffo` for the
     test environment. Register it with
     `pnpm tsx scripts/setup-waffo.ts --store <STORE_ID> --url <tunnel>/api/webhooks/waffo`
     (see `docs/waffo/SKILL.md` → Configuring Webhook URLs).
4. `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY` (PEM), and the three
   `VITE_WAFFO_PRODUCT_*` IDs in the shell or an `.env*` file. The runner
   loads env via Vite's `loadEnv('e2e')`; `.dev.vars` alone is **not**
   loaded. If deploying via Cloudflare, run `pnpm cf-typegen` after adding
   credentials.

Optional: override the base URL with
`PLAYWRIGHT_BASE_URL=https://<tunnel>.trycloudflare.com pnpm e2e:waffo` to
walk the tunnel directly instead of localhost.

### Known gaps

The Playwright suite does not yet cover:
- Hosted consumer portal navigation
- Subscription upgrade / downgrade
- Refund revoking access
- Real-time renewal and past-due recovery flows (their webhook contracts are
  unit-covered via `tests/unit/payment/waffo-provider.test.ts`)

## Clef decision demo

At `/ai#decision-model`, select Clef or Clef Flash, load a support-ticket preset or enter a ticket, and submit it. The selected model receives the state and three typed questions; the page displays urgency, team probabilities and severity. Empty input disables submission; provider failures are surfaced and the user can retry. Local UI tests mock the server-function response; live Workers AI verification is separate.

AI model refresh: summaries, taglines and captions use Gemma 4 chat-completion responses; speech uses Aura 2 supported voices and MP3; FLUX.2 image generation uses multipart input. The model picker uses the shared Select controls. Verify real provider output separately from deterministic local tests.

### Authentication mail recovery

- Registration success exposes verification resend; an unverified credential
  login exposes the same recovery control without granting a session.
- Resend uses the existing verification endpoint, remains available after a
  delivery failure, and prevents repeated clicks for 60 seconds after acceptance.
- Local unit integration exercises the installed auth handler with a fake mail
  sender: immediate success, recovery on the third attempt, persistent failure,
  wrong-password boundary, and uniform password-reset responses for unknown users
  and failed delivery. No external mail provider is invoked.

## Web search demo

At `/ai#web-search`, load one of three query presets or enter a query, select Ceramic.ai, Exa or Linkup, and search. Empty input disables submission. Results expose source links and descriptions; changing input/provider clears stale output. Provider failures allow retry. Local UI tests intercept server-function requests; live provider evidence is separate.
