# Environment Variables

The project uses **T3 Env** (`@t3-oss/env-core`) for type-safe validation:

| Source | File | When | Prefix / source |
|--------|------|------|------------------|
| **clientEnv** | `src/env/client.ts` | Build time (Vite) | `VITE_*` from `import.meta.env` |
| **serverEnv** | `src/env/server.ts` | Runtime (Worker) | `process.env` (Wrangler vars/secrets) |

**Rule of thumb:** Use **clientEnv** for values inlined at build (public URLs, analytics IDs, feature keys). Use **serverEnv** for secrets and server-only config (API keys, webhook secrets). Deployment target is **Cloudflare Workers**.

> The payment providers (`src/payment/provider/stripe.ts`, `creem.ts`, `waffo.ts`) read their secrets from `process.env` directly instead of `serverEnv`. The variables are still declared in `serverEnv` for validation, and the Stripe and Creem E2E runners inject them through the Cloudflare Vite plugin (`vite.config.ts`).

---

## 1. Build-time (clientEnv)

Values are read by Vite from `.env*` during `pnpm dev` / `pnpm build` and inlined into the bundle. They are **not** available again at Worker runtime.

**Where to set:** Local → `.env.local`. Production → `.env.production` or CI/build environment variables. Only **`VITE_`**-prefixed variables are exposed to app code.

### Variables

| Variable | Purpose | Required | Notes |
|----------|---------|----------|--------|
| **Base** | | | |
| `VITE_BASE_URL` | Site origin (e.g. `getBaseUrl()`) | No | Default: `http://localhost:3000` |
| **Payment** | | | |
| `VITE_PAYMENT_PROVIDER` | Payment provider (`stripe`, `creem`, `waffo`, or `''`) | No | Default: `''` (payment disabled); set to one provider to enable |
| **Payment (Stripe)** | | | |
| `VITE_STRIPE_PRICE_PRO_MONTHLY` | Stripe Price ID (Pro monthly) | No | Required for pricing/checkout when using Stripe |
| `VITE_STRIPE_PRICE_PRO_YEARLY` | Stripe Price ID (Pro yearly) | No | |
| `VITE_STRIPE_PRICE_LIFETIME` | Stripe Price ID (Lifetime) | No | |
| **Payment (Creem)** | | | |
| `VITE_CREEM_PRODUCT_PRO_MONTHLY` | Creem Product ID (Pro monthly) | No | Required for pricing/checkout when using Creem |
| `VITE_CREEM_PRODUCT_PRO_YEARLY` | Creem Product ID (Pro yearly) | No | |
| `VITE_CREEM_PRODUCT_LIFETIME` | Creem Product ID (Lifetime) | No | |
| **Payment (Waffo Pancake)** | | | |
| `VITE_WAFFO_PRODUCT_PRO_MONTHLY` | Waffo Product ID (Pro monthly) | No | Required for pricing/checkout when using Waffo |
| `VITE_WAFFO_PRODUCT_PRO_YEARLY` | Waffo Product ID (Pro yearly) | No | |
| `VITE_WAFFO_PRODUCT_LIFETIME` | Waffo Product ID (Lifetime) | No | |
| **Analytics** | | | |
| `VITE_GOOGLE_ANALYTICS_ID` | Google Analytics | No | |
| `VITE_CLARITY_PROJECT_ID` | Microsoft Clarity | No | |
| `VITE_PLAUSIBLE_SCRIPT` | Plausible script URL | No | |
| `VITE_UMAMI_WEBSITE_ID` | Umami Analytics | No | |
| `VITE_UMAMI_SCRIPT` | Umami script URL | No | |
| **Chat & support** | | | |
| `VITE_CRISP_WEBSITE_ID` | Crisp chat | No | When set, `CrispChat` loads the Crisp SDK after browser idle time |

Do **not** put `VITE_*` in Wrangler `vars` or `wrangler secret`—they are build-time only.

Analytics components and the Crisp/client scripts only render when `import.meta.env.PROD` is true, so they stay inactive during `pnpm dev` even when their IDs are set.

---

## 2. Runtime (serverEnv)

Read at **Worker request time**. Used for secrets, API keys, and server-only config.

**Where to set:** Local → `.env.local` (loaded into `process.env` by the dev process). Cloudflare Workers → **`wrangler secret put <NAME>`** for secrets, or **`vars`** in `wrangler.jsonc` for non-sensitive values. With `nodejs_compat_populate_process_env` enabled, vars and secrets appear on `process.env`. D1/R2/KV and other **bindings** are accessed via `env.DB`, `env.BUCKET`, `env.CACHE`, etc., not `process.env`.

### Variables

| Variable | Purpose | Required | Used by |
|----------|---------|----------|---------|
| **Base** | | | |
| `VITE_BASE_URL` | URL (schema validation at runtime) | No | Default: `http://localhost:3000`; same value as build |
| **Auth** | | | |
| `BETTER_AUTH_SECRET` | Better Auth session signing | Yes (prod) | Auth. Defaults to the literal `'better-auth-secret'` so CLI tools can run; always set a real secret in every deployed environment |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Better Auth / extension CORS origins | No | Default `''`. Comma-separated origins such as `chrome-extension://<extension-id>`; `moz-extension://*` trusts any Firefox extension origin. See [Auth](./auth.md#browser-extension-auth) |
| `GOOGLE_CLIENT_ID` | Google OAuth | No | Auth when Google login enabled |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | No | Auth when Google login enabled |
| `GOOGLE_EXTENSION_CLIENT_ID` | Browser extension Google OAuth | No | Added as a Google ID-token audience, required as the tokeninfo `aud` for extension access tokens, and required by `POST /api/auth/extension/google` (returns `503` without it) |
| **Mail & newsletter (Resend)** | | | |
| `RESEND_API_KEY` | Resend API | No | [Mail](./mail.md), [Newsletter](./newsletter.md) (when using Resend) |
| **Cloudflare API** | | | |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | No | [Mail](./mail.md) (Cloudflare provider), [AI](./ai.md) (Workers AI REST), and drizzle-kit (`drizzle.config.ts`) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | No | Same consumers as `CLOUDFLARE_ACCOUNT_ID`; the token needs Email Send, Workers AI, and D1 permissions for the features you use |
| **Newsletter (Beehiiv)** | | | |
| `BEEHIIV_API_KEY` | Beehiiv API | No | Newsletter when provider is Beehiiv |
| `BEEHIIV_PUBLICATION_ID` | Beehiiv publication | No | Newsletter when provider is Beehiiv |
| **Newsletter (MailCheap)** | | | |
| `MAILCHEAP_API_KEY` | MailCheap full-access API key (server-only secret) | When selected | [Newsletter](./newsletter.md) when provider is `mailcheap`; signups-only keys cannot read status or unsubscribe |
| `MAILCHEAP_NEWSLETTER_ID` | MailCheap newsletter ID or slug | When selected | Required together with `MAILCHEAP_API_KEY`; scopes all contact operations to this newsletter |
| **Notification** | | | |
| `DISCORD_WEBHOOK_URL` | Discord webhook | No | Notification (Discord) |
| `FEISHU_WEBHOOK_URL` | Feishu webhook | No | Notification (Feishu) |
| **Payment (Stripe)** | | | |
| `STRIPE_SECRET_KEY` | Stripe API key | No | [Payment](./payment.md); required when using Stripe |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing | No | Payment webhook (Stripe) |
| **Payment (Creem)** | | | |
| `CREEM_API_KEY` | Creem API key | No | [Payment](./payment.md); required when using Creem |
| `CREEM_WEBHOOK_SECRET` | Creem webhook signing | No | Payment webhook (Creem) |
| `CREEM_DEBUG` | Use Creem sandbox API | No | Set to `true` for test mode (`test-api.creem.io`). `.env.example` ships `CREEM_DEBUG='true'`, so set it to `false` or remove it for production |
| **Payment (Waffo Pancake)** | | | |
| `WAFFO_DEBUG` | Accept sandbox webhook events in a production build | No | Non-production builds always accept `mode: "test"` events. Set to `true` only for smoke-testing a production build against a Waffo test merchant; leave unset in real production so test webhooks are ignored |
| `WAFFO_MERCHANT_ID` | Waffo Merchant ID | No | [Payment](./payment.md); required when using Waffo |
| `WAFFO_PRIVATE_KEY` | Waffo RSA private key | No | [Payment](./payment.md); server-only secret; never expose it client-side or prefix it with `VITE_` |
| **AI** | | | |
| `FAL_KEY` | fal.ai API key | No | [AI](../src/api/ai.ts); required for image generation/edit via fal.ai |

### Tooling-only variables

These are read by CLI tools and scripts, not by the Worker.

| Variable | Used by | Notes |
|----------|---------|-------|
| `CLOUDFLARE_DATABASE_ID` | `drizzle.config.ts` (`db:generate`, `db:push`, `db:studio:remote`) | D1 database ID; also needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` |
| `WAFFO_STORE_ID` | `scripts/setup-waffo.ts` | Waffo store to configure |
| `WRANGLER_BIN` | `scripts/sync-d1-remote-to-local.ts` | Override the wrangler binary |
| `GITHUB_REPOSITORY` | `scripts/sync-github-secrets.ts` | Target `owner/name` when `--repo` is not passed |

### E2E variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `PLAYWRIGHT_BASE_URL` | All Playwright configs | Target URL (local server or tunnel) |
| `PORT` | `playwright.config.ts` | Local E2E port (default `3000`) |
| `CI` | Playwright configs | Enables retries and the GitHub reporter |
| `E2E_PERSIST_PATH` | `vite.config.ts`, `scripts/prepare-e2e-state.ts` | Isolated local D1/R2/KV state (must stay inside `.wrangler/`) |
| `STRIPE_E2E_PORT` | `scripts/run-stripe-e2e.ts` | See [Stripe E2E](../tests/e2e/stripe/README.md) |
| `CREEM_E2E_PORT` | `scripts/run-creem-e2e.ts` | See [Creem E2E](../tests/e2e/creem/README.md) |
| `WAFFO_E2E_PORT` | `scripts/run-waffo-e2e.ts` | See [Waffo E2E](../tests/e2e/waffo/README.md) |

All three payment runners use `scripts/run-payment-e2e.ts` and
`vite.payment-e2e.config.ts` to inject only the selected provider credentials
and a fixed E2E `BETTER_AUTH_SECRET`. Stripe injects the webhook secret returned
by its CLI listener. An isolated temporary Worker configuration excludes the
developer's `.dev.vars` and is removed when Playwright exits. The regular
`vite.config.ts` contains no payment-specific test configuration.

Vite mode `e2e` (`vite dev --mode e2e`) is not an env variable but changes runtime behavior: it enables the `/api/e2e/users` helper route (dev only, with the hardcoded `x-e2e-secret` header) and disables notifications (`websiteConfig.notification.enable`).

---

## 3. Worker bindings

Bindings are configured in `wrangler.jsonc`, not `serverEnv`.

| Binding | Resource | Used by |
|---------|----------|---------|
| `DB` | Cloudflare D1 | Database / Drizzle |
| `BUCKET` | Cloudflare R2 | [Storage](./storage.md) |
| `CACHE` | Cloudflare KV | [Cache](./cache.md), newsletter status caching |

---

## 4. VITE_BASE_URL and getBaseUrl()

`getBaseUrl()` in `src/lib/urls.ts` reads **clientEnv.VITE_BASE_URL** (build-time).

- **Local:** Set in `.env.local` or omit to use default `http://localhost:3000`.
- **Production:** Set in the **build environment** (e.g. `.env.production` or CI). You do **not** set it in Worker runtime vars.

---

## 5. Files and config overview

| File / mechanism | When it applies | Notes |
|------------------|-----------------|--------|
| `.env.local` | Present during `pnpm dev` | Build + runtime locally; git-ignored |
| `.env.production` | During `pnpm build` | Production build (e.g. `VITE_BASE_URL`); do not commit secrets |
| `wrangler.jsonc` `vars` | Worker runtime | Non-sensitive config → `process.env` when nodejs compat is on |
| `wrangler secret put <NAME>` | Worker runtime | Secrets → `process.env` |

Copy **`.env.example`** to **`.env.local`** and fill in values. See module docs ([Auth](./auth.md), [Mail](./mail.md), [Payment](./payment.md), etc.) for which vars each feature needs.
