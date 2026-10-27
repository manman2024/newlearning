import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@waffo/pancake-ts', () => ({
  WaffoPancake: class {},
  verifyWebhook: mocks.verifyWebhook,
  // Runtime enum shape matching the SDK; tests use the string values below.
  WebhookEventType: {
    OrderCompleted: 'order.completed',
    SubscriptionActivated: 'subscription.activated',
    SubscriptionPaymentSucceeded: 'subscription.payment_succeeded',
    SubscriptionRenewed: 'subscription.renewed',
    SubscriptionRecovered: 'subscription.recovered',
    SubscriptionPlanChanged: 'subscription.plan_changed',
    SubscriptionCanceling: 'subscription.canceling',
    SubscriptionUncanceled: 'subscription.uncanceled',
    SubscriptionCanceled: 'subscription.canceled',
    SubscriptionPastDue: 'subscription.past_due',
    RefundSucceeded: 'refund.succeeded',
    RefundFailed: 'refund.failed',
  },
  // Minimal stand-in for the SDK error class so `instanceof` checks work.
  WaffoPancakeError: class extends Error {
    status: number;
    errors: Array<{ layer: string; message: string; aiHint?: string }>;
    constructor(
      status: number,
      errors: Array<{ layer: string; message: string; aiHint?: string }>
    ) {
      super(errors[0]?.message ?? 'WaffoPancakeError');
      this.status = status;
      this.errors = errors;
    }
  },
}));

vi.mock('@/db', () => ({
  getDb: () => ({
    insert: mocks.insert,
    update: mocks.update,
  }),
}));

vi.mock('@/notification', () => ({
  sendPaymentNotification: vi.fn(),
}));

vi.mock('@/lib/price-plan', () => ({
  findPlanByPlanId: vi.fn(() => ({ id: 'pro' })),
  findPriceInPlan: vi.fn(() => ({
    type: 'subscription',
    priceId: 'PROD_monthly',
    amount: 990,
    currency: 'USD',
  })),
}));

import { WaffoProvider } from '@/payment/provider/waffo';
import { handleWaffoWebhookRequest } from '@/routes/api/webhooks/waffo';

function waffoRequest(payload: string, signature?: string): Request {
  const headers: Record<string, string> = {};
  if (signature) headers['x-waffo-signature'] = signature;
  return new Request('https://example.com/api/webhooks/waffo', {
    method: 'POST',
    body: payload,
    headers,
  });
}

function dependencies(provider: WaffoProvider) {
  return {
    isPaymentEnabled: () => true,
    getPaymentProviderName: () => 'waffo' as const,
    handleWebhookEvent: provider.handleWebhookEvent.bind(provider),
  };
}

const orderCompletedPayload = '{"eventType":"order.completed"}';

describe('Waffo webhook HTTP route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.WAFFO_MERCHANT_ID = 'MER_test';
    process.env.WAFFO_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockResolvedValue(undefined);
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([{ id: 'payment_123' }]);
  });

  test('acknowledges a successfully processed verified event', async () => {
    // refund.failed only logs, so it exercises the route without DB writes.
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_1',
      eventId: 'EVT_1',
      eventType: 'refund.failed',
      mode: 'test',
      data: { orderId: 'ORD_1' },
    });

    const response = await handleWaffoWebhookRequest(
      waffoRequest('{"eventType":"refund.failed"}', 'signed'),
      dependencies(new WaffoProvider())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects an invalid Waffo signature without acknowledging it', async () => {
    mocks.verifyWebhook.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const response = await handleWaffoWebhookRequest(
      waffoRequest(orderCompletedPayload, 'bad-signature'),
      dependencies(new WaffoProvider())
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid Waffo signature',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects a missing signature header', async () => {
    const response = await handleWaffoWebhookRequest(
      waffoRequest(orderCompletedPayload),
      dependencies(new WaffoProvider())
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing payload or signature',
    });
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
  });

  test('rejects requests when Waffo is not the active provider', async () => {
    const provider = new WaffoProvider();
    const response = await handleWaffoWebhookRequest(
      waffoRequest(orderCompletedPayload, 'signed'),
      {
        ...dependencies(provider),
        getPaymentProviderName: () => 'stripe',
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Waffo is not the active payment provider',
    });
    expect(mocks.verifyWebhook).not.toHaveBeenCalled();
  });

  test('acknowledges an event from the wrong mode without processing it', async () => {
    // Vitest runs with import.meta.env.PROD === false, so the provider
    // expects test-mode events; a live event is skipped with a warning.
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_live',
      eventId: 'EVT_live',
      eventType: 'order.completed',
      mode: 'live',
      data: { orderId: 'ORD_live' },
    });

    const response = await handleWaffoWebhookRequest(
      waffoRequest(orderCompletedPayload, 'signed'),
      dependencies(new WaffoProvider())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('requests a Waffo retry after a temporary processing failure', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_123',
      eventId: 'PAY_123',
      eventType: 'order.completed',
      mode: 'test',
      data: {
        orderId: 'ORD_123',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '19.00',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        paymentId: 'PAY_123',
        orderMetadata: {
          planId: 'pro',
          priceId: 'PROD_monthly',
          userId: 'user_123',
        },
      },
    });
    mocks.values.mockRejectedValueOnce(
      new Error('D1_ERROR: temporary database unavailable')
    );
    const provider = new WaffoProvider();

    const failedResponse = await handleWaffoWebhookRequest(
      waffoRequest(orderCompletedPayload, 'signed'),
      dependencies(provider)
    );
    const retryResponse = await handleWaffoWebhookRequest(
      waffoRequest(orderCompletedPayload, 'signed'),
      dependencies(provider)
    );

    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toEqual({
      error: 'Webhook processing failed',
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toEqual({ received: true });
  });

  test('requests a retry when renewal arrives before subscription.activated', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_renewed_early',
      eventId: 'EVT_renewed_early',
      eventType: 'subscription.renewed',
      mode: 'test',
      data: {
        orderId: 'ORD_subscription',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '9.90',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        orderStatus: 'active',
        billingPeriod: 'monthly',
        currentPeriodStart: '2026-10-08',
        currentPeriodEnd: '2026-11-08',
      },
    });
    mocks.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'payment_123' }]);
    const provider = new WaffoProvider();
    const request = () =>
      waffoRequest('{"eventType":"subscription.renewed"}', 'signed');

    const failedResponse = await handleWaffoWebhookRequest(
      request(),
      dependencies(provider)
    );
    const retryResponse = await handleWaffoWebhookRequest(
      request(),
      dependencies(provider)
    );

    expect(failedResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
    expect(mocks.returning).toHaveBeenCalledTimes(2);
  });
});
