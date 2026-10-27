import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  update: vi.fn(),
  insert: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  values: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: () => dbMocks,
}));

vi.mock('@/notification', () => ({
  sendPaymentNotification: vi.fn(),
}));

import { CreemProvider } from '@/payment/provider/creem';
import { handleCreemWebhookRequest } from '@/routes/api/webhooks/creem';

const WEBHOOK_SECRET = 'whsec_creem_route_test';

function sign(payload: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
}

function creemRequest(payload: string, signature?: string): Request {
  const headers: Record<string, string> = {};
  if (signature) headers['creem-signature'] = signature;
  return new Request('https://example.com/api/webhooks/creem', {
    method: 'POST',
    body: payload,
    headers,
  });
}

function dependencies(provider: CreemProvider) {
  return {
    isPaymentEnabled: () => true,
    getPaymentProviderName: () => 'creem' as const,
    handleWebhookEvent: provider.handleWebhookEvent.bind(provider),
  };
}

// Signed but unhandled event type: parses, hits the default branch, no DB.
const unhandledPayload = JSON.stringify({
  id: 'evt_unhandled',
  eventType: 'subscription.unknown',
  created_at: 1_757_000_000,
  object: {},
});

const timestamp = '2026-09-05T00:00:00.000Z';
const checkoutPayload = JSON.stringify({
  id: 'evt_checkout_completed',
  eventType: 'checkout.completed',
  created_at: Date.parse(timestamp),
  object: {
    id: 'CHK_test',
    mode: 'test',
    object: 'checkout',
    status: 'completed',
    request_id: 'checkout_dedup_key',
    metadata: { userId: 'user_buyer' },
    product: {
      id: 'PROD_lifetime',
      mode: 'test',
      object: 'product',
      name: 'Lifetime',
      description: 'Lifetime plan',
      price: 19900,
      currency: 'USD',
      billing_type: 'onetime',
      billing_period: 'once',
      status: 'active',
      tax_mode: 'inclusive',
      tax_category: 'saas',
      created_at: timestamp,
      updated_at: timestamp,
    },
    customer: {
      id: 'cus_creem_buyer',
      mode: 'test',
      object: 'customer',
      email: 'buyer@example.com',
      country: 'US',
      created_at: timestamp,
      updated_at: timestamp,
    },
  },
});

const subscriptionPaidPayload = JSON.stringify({
  id: 'evt_subscription_paid',
  eventType: 'subscription.paid',
  created_at: Date.parse(timestamp),
  object: {
    id: 'sub_creem_buyer',
    mode: 'test',
    object: 'subscription',
    customer: {
      id: 'cus_creem_buyer',
      mode: 'test',
      object: 'customer',
      email: 'buyer@example.com',
      country: 'US',
      created_at: timestamp,
      updated_at: timestamp,
    },
    product: {
      id: 'PROD_monthly',
      mode: 'test',
      object: 'product',
      name: 'Pro Monthly',
      description: 'Monthly plan',
      price: 990,
      currency: 'USD',
      billing_type: 'recurring',
      billing_period: 'every-month',
      status: 'active',
      tax_mode: 'inclusive',
      tax_category: 'saas',
      created_at: timestamp,
      updated_at: timestamp,
    },
    collection_method: 'charge_automatically',
    status: 'active',
    current_period_start_date: timestamp,
    current_period_end_date: '2026-10-05T00:00:00.000Z',
    created_at: timestamp,
    updated_at: timestamp,
  },
});

describe('Creem webhook HTTP route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CREEM_API_KEY = 'key_test';
    process.env.CREEM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.CREEM_DEBUG = 'true';
  });

  test('acknowledges a successfully processed signed event', async () => {
    const response = await handleCreemWebhookRequest(
      creemRequest(unhandledPayload, sign(unhandledPayload)),
      dependencies(new CreemProvider())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  test('rejects an invalid Creem signature without acknowledging it', async () => {
    const response = await handleCreemWebhookRequest(
      creemRequest(unhandledPayload, 'invalid-signature'),
      dependencies(new CreemProvider())
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid Creem signature',
    });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  test('rejects a missing signature header', async () => {
    const response = await handleCreemWebhookRequest(
      creemRequest(unhandledPayload),
      dependencies(new CreemProvider())
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing payload or signature',
    });
  });

  test('rejects requests when Creem is not the active provider', async () => {
    const provider = new CreemProvider();
    const response = await handleCreemWebhookRequest(
      creemRequest(unhandledPayload, sign(unhandledPayload)),
      {
        ...dependencies(provider),
        getPaymentProviderName: () => 'stripe',
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Creem is not the active payment provider',
    });
    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  test('requests a Creem retry after a temporary processing failure', async () => {
    dbMocks.update.mockReturnValue({ set: dbMocks.set });
    dbMocks.set.mockReturnValue({ where: dbMocks.where });
    dbMocks.where
      .mockRejectedValueOnce(
        new Error('D1_ERROR: temporary database unavailable')
      )
      .mockResolvedValueOnce(undefined);
    dbMocks.insert.mockReturnValue({ values: dbMocks.values });
    dbMocks.values.mockResolvedValue(undefined);
    const provider = new CreemProvider();

    const failedResponse = await handleCreemWebhookRequest(
      creemRequest(checkoutPayload, sign(checkoutPayload)),
      dependencies(provider)
    );
    const retryResponse = await handleCreemWebhookRequest(
      creemRequest(checkoutPayload, sign(checkoutPayload)),
      dependencies(provider)
    );

    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toEqual({
      error: 'Webhook processing failed',
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual({ received: true });
  });

  test('requests a retry when subscription.paid arrives before checkout.completed', async () => {
    dbMocks.update.mockReturnValue({ set: dbMocks.set });
    dbMocks.set.mockReturnValue({ where: dbMocks.where });
    dbMocks.where.mockReturnValue({ returning: dbMocks.returning });
    dbMocks.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'payment_creem' }]);
    const provider = new CreemProvider();
    const request = () =>
      creemRequest(subscriptionPaidPayload, sign(subscriptionPaidPayload));

    const failedResponse = await handleCreemWebhookRequest(
      request(),
      dependencies(provider)
    );
    const retryResponse = await handleCreemWebhookRequest(
      request(),
      dependencies(provider)
    );

    expect(failedResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
    expect(dbMocks.returning).toHaveBeenCalledTimes(2);
  });
});
