import Stripe from 'stripe';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: () => ({
    insert: dbMocks.insert,
  }),
}));

vi.mock('@/notification', () => ({
  sendPaymentNotification: vi.fn(),
}));

import { StripeProvider } from '@/payment/provider/stripe';
import { InvalidWebhookSignatureError } from '@/payment/errors';

const WEBHOOK_SECRET = 'whsec_e2e_fast_webhook_secret';

function signedCheckoutEvent(overrides: Record<string, unknown> = {}) {
  const suffix = Date.now().toString();
  const event = {
    id: `evt_fast_${suffix}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `cs_test_fast_${suffix}`,
        object: 'checkout.session',
        customer: `cus_fast_${suffix}`,
        invoice: `in_fast_${suffix}`,
        metadata: {
          priceId: `price_fast_${suffix}`,
          userId: `user_fast_${suffix}`,
        },
        mode: 'payment',
        ...overrides,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'checkout.session.completed',
  };
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  return { event, payload, signature };
}

describe('Stripe webhook boundary', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fast_webhook_key';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    dbMocks.insert.mockReturnValue({ values: dbMocks.values });
    dbMocks.values.mockResolvedValue(undefined);
  });

  test('rejects an invalid Stripe signature before writing a payment', async () => {
    const provider = new StripeProvider();

    await expect(
      provider.handleWebhookEvent('{"id":"evt_invalid"}', 'invalid')
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  test('records a signed one-time checkout as a pending lifetime payment', async () => {
    const provider = new StripeProvider();
    const { event, payload, signature } = signedCheckoutEvent();

    await provider.handleWebhookEvent(payload, signature);

    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: event.data.object.customer,
        invoiceId: event.data.object.invoice,
        paid: false,
        priceId: event.data.object.metadata.priceId,
        scene: 'lifetime',
        sessionId: event.data.object.id,
        status: 'completed',
        type: 'one_time',
        userId: event.data.object.metadata.userId,
      })
    );
  });

  test('keeps a Stripe-confirmed one-time checkout pending until invoice.paid', async () => {
    const provider = new StripeProvider();
    const { payload, signature } = signedCheckoutEvent({
      payment_status: 'paid',
    });

    await provider.handleWebhookEvent(payload, signature);

    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false })
    );
  });

  test('acknowledges a replay when D1 reports a duplicate invoice', async () => {
    const provider = new StripeProvider();
    const { payload, signature } = signedCheckoutEvent();
    dbMocks.values
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error('D1_ERROR: UNIQUE constraint failed: payment.invoice_id')
      );

    await provider.handleWebhookEvent(payload, signature);
    await expect(
      provider.handleWebhookEvent(payload, signature)
    ).resolves.toBeUndefined();
    expect(dbMocks.values).toHaveBeenCalledTimes(2);
  });
});
