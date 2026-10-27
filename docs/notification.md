# Notification module

Sends a "new purchase" message to a chat webhook when a **lifetime (one-time) payment** completes. Built-in providers: **Discord** and **Feishu**. Uses the same provider-registry + lazy-singleton pattern as Mail, Newsletter, and Cache.

**Consumers:** the lifetime purchase handlers of all three payment providers (`src/payment/provider/stripe.ts`, `creem.ts`, `waffo.ts`). Subscription payments and renewals do not send notifications.

---

## Directory structure

```
src/notification/
├── index.ts           # sendPaymentNotification, getNotificationProvider; providerRegistry
├── types.ts           # NotificationProviderName, SendPaymentNotificationParams, NotificationProvider
└── provider/
    ├── discord.ts     # DiscordProvider (webhook embed)
    └── feishu.ts      # FeishuProvider (webhook text message)
```

---

## Configuration

| Source | Key | Description |
|--------|-----|-------------|
| `websiteConfig.notification` | `enable` | Master switch. Template default: `import.meta.env.MODE !== 'e2e'`, so notifications are off during E2E runs. When false, `sendPaymentNotification` returns immediately. |
| | `provider` | `'discord'` \| `'feishu'`. |
| `serverEnv` (`src/env/server.ts`) | `DISCORD_WEBHOOK_URL` | Required when provider is `discord`. |
| | `FEISHU_WEBHOOK_URL` | Required when provider is `feishu`. |

Create the webhook in your Discord channel settings (Integrations → Webhooks) or Feishu group bot settings.

---

## Core API (`@/notification`)

- **sendPaymentNotification({ sessionId, customerId, userName, amount })** → `Promise<void>`. Does nothing when `enable` is false.
- **getNotificationProvider()** — lazily creates the configured provider (module-level singleton). Throws when no provider is configured.

`SendPaymentNotificationParams`: `{ sessionId, customerId, userName, amount }` (amount in major currency units, e.g. dollars).

---

## Providers

**Discord** — POSTs an embed titled "New Purchase" with Username, Amount (`$x.xx`), Customer ID, and Session ID. The embed username is `websiteConfig.metadata.name`, and the avatar is `getBaseUrl() + metadata.images.logoLight` when configured.

**Feishu** — POSTs a plain-text message (`msg_type: 'text'`) with the same fields.

Both providers only log network failures; they never throw from `sendPaymentNotification`.

> **Caveat:** a provider's **constructor** throws when its webhook URL is missing, and `sendPaymentNotification` does not catch provider-construction errors. If notifications are enabled without the env var set, the exception reaches the calling payment webhook handler (Waffo wraps the call in try/catch; Stripe and Creem rely on their webhook error handling). Set the webhook URL whenever notifications are enabled.

---

## Caller behavior

| Provider | Trigger | `amount` | `sessionId` | `userName` |
|----------|---------|----------|-------------|------------|
| Stripe | `processLifetimePlanPurchase` | `invoice.amount_paid / 100` | Checkout Session ID | session metadata `userName`, fallback `Customer` |
| Creem | lifetime `checkout.completed` | `product.price / 100` | event ID | metadata `userName` → customer name → `Customer` |
| Waffo | lifetime `order.completed` | `Number(amount)` | order ID | order metadata `userName` → buyer email |

Stripe emits the notification only from the handler that actually flips the payment row from unpaid to paid, so duplicate or out-of-order deliveries do not double-notify.

---

## Adding a provider

1. Extend `NotificationConfig.provider` in `src/types/index.d.ts`.
2. Implement `NotificationProvider` in `src/notification/provider/<name>.ts`.
3. Register a factory in `providerRegistry` in `src/notification/index.ts`.
4. Add the provider's env vars to `serverEnv` in `src/env/server.ts` and to [Env](./env.md).
