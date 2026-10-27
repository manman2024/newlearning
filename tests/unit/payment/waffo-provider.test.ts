import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  verifyWebhook: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@waffo/pancake-ts', () => ({
  WaffoPancake: class {
    checkout = {
      authenticated: {
        create: mocks.createCheckout,
      },
    };
  },
  verifyWebhook: mocks.verifyWebhook,
  // Runtime enum shape matching the SDK; test uses the string values below.
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

describe('Waffo provider boundary', () => {
  beforeEach(() => {
    process.env.WAFFO_MERCHANT_ID = 'MER_test';
    process.env.WAFFO_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';
    mocks.createCheckout.mockReset();
    mocks.verifyWebhook.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
    mocks.values.mockReset();
    mocks.set.mockReset();
    mocks.where.mockReset();
    mocks.returning.mockReset();
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.values.mockResolvedValue(undefined);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([{ id: 'payment_123' }]);
    mocks.createCheckout.mockResolvedValue({
      checkoutUrl: 'https://pancake.waffo.ai/checkout/CHK_test',
      sessionId: 'CHK_test',
      expiresAt: '2026-08-01T00:00:00.000Z',
    });
  });

  test('creates an authenticated Waffo checkout from a fixed template price', async () => {
    const provider = new WaffoProvider();

    await expect(
      provider.createCheckout({
        planId: 'pro',
        priceId: 'PROD_monthly',
        customerEmail: 'buyer@example.com',
        successUrl: 'https://example.com/settings/billing',
        metadata: {
          paymentReference: 'checkout_ref',
          userId: 'user_123',
          userName: 'Buyer',
        },
      })
    ).resolves.toEqual({
      id: 'CHK_test',
      url: 'https://pancake.waffo.ai/checkout/CHK_test',
    });

    expect(mocks.createCheckout).toHaveBeenCalledWith({
      buyerIdentity: 'user_123',
      buyerEmail: 'buyer@example.com',
      currency: 'USD',
      metadata: {
        paymentReference: 'checkout_ref',
        userId: 'user_123',
        userName: 'Buyer',
        planId: 'pro',
        priceId: 'PROD_monthly',
      },
      orderMerchantExternalId: 'checkout_ref',
      productId: 'PROD_monthly',
      successUrl: 'https://example.com/settings/billing',
    });
  });

  test('maps the site locale and resolved theme to the Waffo checkout', async () => {
    const provider = new WaffoProvider();

    await provider.createCheckout({
      planId: 'pro',
      priceId: 'PROD_monthly',
      customerEmail: 'buyer@example.com',
      locale: 'zh',
      theme: 'dark',
      metadata: { userId: 'user_123' },
    });

    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'zh-Hans',
        darkMode: true,
      })
    );

    mocks.createCheckout.mockClear();

    await provider.createCheckout({
      planId: 'pro',
      priceId: 'PROD_monthly',
      customerEmail: 'buyer@example.com',
      locale: 'en',
      theme: 'light',
      metadata: { userId: 'user_123' },
    });

    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en',
        darkMode: false,
      })
    );
  });

  test('records an order.completed webhook using existing payment columns', async () => {
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
        orderMerchantExternalId: 'checkout_ref',
        orderMetadata: {
          paymentReference: 'metadata_fallback_ref',
          planId: 'pro',
          priceId: 'PROD_monthly',
          userId: 'user_123',
        },
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"order.completed"}',
      'signed'
    );

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ORD_123',
        invoiceId: 'PAY_123',
        paid: true,
        priceId: 'PROD_monthly',
        sessionId: 'checkout_ref',
        status: 'completed',
        type: 'one_time',
        userId: 'user_123',
      })
    );
  });

  test('updates an existing subscription when Waffo reports cancellation at period end', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_canceling',
      eventId: 'EVT_canceling',
      eventType: 'subscription.canceling',
      mode: 'test',
      data: {
        orderId: 'ORD_subscription',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '9.90',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        orderStatus: 'canceling',
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.canceling"}',
      'signed'
    );

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        paid: true,
        status: 'active',
        updatedAt: expect.any(Date),
      })
    );
  });

  test('does not mutate subscription lifecycle state for a payment event', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_paid',
      eventId: 'EVT_paid',
      eventType: 'subscription.payment_succeeded',
      mode: 'test',
      data: {
        orderId: 'ORD_subscription',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '9.90',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.payment_succeeded"}',
      'signed'
    );

    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('advances the subscription period on subscription.renewed', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_renewed',
      eventId: 'ORD_subscription-renewed-2026-10-08',
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

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.renewed"}',
      'signed'
    );

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: false,
        interval: 'month',
        paid: true,
        periodStart: new Date('2026-10-08'),
        periodEnd: new Date('2026-11-08'),
        status: 'active',
      })
    );
  });

  test('retries a renewal that arrives before subscription.activated', async () => {
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

    await expect(
      provider.handleWebhookEvent(
        '{"eventType":"subscription.renewed"}',
        'signed'
      )
    ).rejects.toThrow('Failed to handle Waffo webhook event');
    await expect(
      provider.handleWebhookEvent(
        '{"eventType":"subscription.renewed"}',
        'signed'
      )
    ).resolves.toBeUndefined();

    expect(mocks.returning).toHaveBeenCalledTimes(2);
  });

  test('restores lifecycle state on subscription.recovered', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_recovered',
      eventId: 'EVT_recovered',
      eventType: 'subscription.recovered',
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

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.recovered"}',
      'signed'
    );

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: false,
        paid: true,
        periodStart: new Date('2026-10-08'),
        periodEnd: new Date('2026-11-08'),
        status: 'active',
      })
    );
  });

  test('revokes lifetime access when Waffo reports a successful full refund', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_refund',
      eventId: 'REFUND_123',
      eventType: 'refund.succeeded',
      mode: 'test',
      data: {
        orderId: 'ORD_123',
        paymentId: 'PAY_123',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '199.00',
        taxAmount: '0.00',
        productName: 'Lifetime',
        refundStatus: 'succeeded',
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"refund.succeeded"}',
      'signed'
    );

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false, updatedAt: expect.any(Date) })
    );
  });

  test('inserts a subscription payment on subscription.activated', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_activated',
      eventId: 'EVT_activated',
      eventType: 'subscription.activated',
      mode: 'test',
      data: {
        orderId: 'ORD_sub_1',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '9.90',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        orderStatus: 'active',
        billingPeriod: 'monthly',
        currentPeriodStart: '2026-08-01T00:00:00.000Z',
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
        orderMetadata: {
          paymentReference: 'subscription_checkout_ref',
          planId: 'pro',
          priceId: 'PROD_monthly',
          userId: 'user_123',
        },
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.activated"}',
      'signed'
    );

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ORD_sub_1',
        subscriptionId: 'ORD_sub_1',
        priceId: 'PROD_monthly',
        userId: 'user_123',
        interval: 'month',
        status: 'active',
        paid: true,
        cancelAtPeriodEnd: false,
        sessionId: 'subscription_checkout_ref',
        type: 'subscription',
      })
    );
  });

  test('syncs priceId and interval on subscription.plan_changed', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_updated',
      eventId: 'EVT_updated',
      eventType: 'subscription.plan_changed',
      mode: 'test',
      data: {
        orderId: 'ORD_sub_1',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '99.00',
        taxAmount: '0.00',
        productName: 'Pro Yearly',
        orderStatus: 'active',
        billingPeriod: 'yearly',
        orderMetadata: { priceId: 'PROD_monthly' },
        productMetadata: { priceId: 'PROD_yearly' },
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.plan_changed"}',
      'signed'
    );

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        // Waffo keeps the original checkout metadata on the order, so the
        // current product metadata must win after a plan change.
        priceId: 'PROD_yearly',
        interval: 'year',
        status: 'active',
        paid: true,
      })
    );
  });

  test('skips webhook events whose mode does not match the runtime', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_prod_in_test',
      eventId: 'EVT_prod',
      eventType: 'order.completed',
      // Runtime is dev/test but the payload says prod: must be ignored.
      mode: 'prod',
      data: {
        orderId: 'ORD_prod',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '19.00',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        paymentId: 'PAY_prod',
        orderMetadata: {
          planId: 'pro',
          priceId: 'PROD_monthly',
          userId: 'user_123',
        },
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"order.completed"}',
      'signed'
    );

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('falls back to orderId when refund event omits paymentId', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_refund_no_pay',
      eventId: 'REFUND_no_pay',
      eventType: 'refund.succeeded',
      mode: 'test',
      data: {
        orderId: 'ORD_renewal',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '9.90',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        refundStatus: 'succeeded',
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"refund.succeeded"}',
      'signed'
    );

    // Update must still fire even without paymentId, matching by orderId only.
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false })
    );
  });

  test('ignores subscription events that are missing userId or priceId', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_missing',
      eventId: 'EVT_missing',
      eventType: 'subscription.activated',
      mode: 'test',
      data: {
        orderId: 'ORD_missing',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '0.00',
        taxAmount: '0.00',
        productName: 'Unknown',
        orderStatus: 'active',
        // No orderMetadata → no userId / priceId to resolve.
      },
    });

    await new WaffoProvider().handleWebhookEvent(
      '{"eventType":"subscription.activated"}',
      'signed'
    );

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('swallows duplicate one-time payment (unique violation) on webhook replay', async () => {
    mocks.verifyWebhook.mockReturnValue({
      id: 'delivery_dup',
      eventId: 'PAY_dup',
      eventType: 'order.completed',
      mode: 'test',
      data: {
        orderId: 'ORD_dup',
        buyerEmail: 'buyer@example.com',
        currency: 'USD',
        amount: '19.00',
        taxAmount: '0.00',
        productName: 'Pro Monthly',
        paymentId: 'PAY_dup',
        orderMetadata: {
          planId: 'pro',
          priceId: 'PROD_monthly',
          userId: 'user_123',
        },
      },
    });
    mocks.values.mockRejectedValueOnce(
      new Error('D1_ERROR: UNIQUE constraint failed: payment.id')
    );

    await expect(
      new WaffoProvider().handleWebhookEvent(
        '{"eventType":"order.completed"}',
        'signed'
      )
    ).resolves.toBeUndefined();
  });

  test('returns the shared hosted portal URL for createCustomerPortal', async () => {
    const provider = new WaffoProvider();
    await expect(
      provider.createCustomerPortal({
        customerId: 'user_123',
        returnUrl: 'https://example.com/settings/billing',
      })
    ).resolves.toEqual({
      url: 'https://pancake.waffo.ai/consumer/portal/login',
    });
    expect(provider.requiresCustomerId).toBe(false);
  });

  test('rejects a failed signature verification with a typed error', async () => {
    mocks.verifyWebhook.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    await expect(
      new WaffoProvider().handleWebhookEvent(
        '{"eventType":"order.completed"}',
        'bad-signature'
      )
    ).rejects.toMatchObject({
      name: 'InvalidWebhookSignatureError',
      message: 'Invalid Waffo webhook signature',
    });
  });

  test('constructor throws when required env vars are missing', () => {
    const previousMerchant = process.env.WAFFO_MERCHANT_ID;
    const previousKey = process.env.WAFFO_PRIVATE_KEY;
    const env = process.env as Record<string, string | undefined>;
    try {
      delete env.WAFFO_MERCHANT_ID;
      expect(() => new WaffoProvider()).toThrow(/WAFFO_MERCHANT_ID/);
      process.env.WAFFO_MERCHANT_ID = 'MER_test';
      delete env.WAFFO_PRIVATE_KEY;
      expect(() => new WaffoProvider()).toThrow(/WAFFO_PRIVATE_KEY/);
    } finally {
      if (previousMerchant !== undefined) {
        process.env.WAFFO_MERCHANT_ID = previousMerchant;
      }
      if (previousKey !== undefined) {
        process.env.WAFFO_PRIVATE_KEY = previousKey;
      }
    }
  });
});
