import Stripe from 'stripe';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: () => ({ insert: dbMocks.insert, select: dbMocks.select }),
}));

vi.mock('@/notification', () => ({
  sendPaymentNotification: vi.fn(),
}));

import { StripeProvider } from '@/payment/provider/stripe';
import { handleStripeWebhookRequest } from '@/routes/api/webhooks/stripe';

const WEBHOOK_SECRET = 'whsec_http_route_test_secret';

function signedCheckoutRequest() {
  const payload = JSON.stringify({
    id: 'evt_http_test',
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: 1_756_592_000,
    data: {
      object: {
        id: 'cs_http_test',
        object: 'checkout.session',
        customer: 'cus_http_test',
        invoice: 'in_http_test',
        metadata: {
          priceId: 'price_http_test',
          userId: 'user_http_test',
        },
        mode: 'payment',
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'checkout.session.completed',
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature },
  });
}

function signedInvoiceRequest() {
  const payload = JSON.stringify({
    id: 'evt_invoice_http_test',
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: 1_756_592_000,
    data: {
      object: {
        id: 'in_http_test',
        object: 'invoice',
        customer: 'cus_http_test',
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'invoice.paid',
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature },
  });
}

function dependencies(provider: StripeProvider) {
  return {
    isPaymentEnabled: () => true,
    getPaymentProviderName: () => 'stripe' as const,
    handleWebhookEvent: provider.handleWebhookEvent.bind(provider),
  };
}

function configureInvoiceRecovery(provider: StripeProvider) {
  const stripe = (
    provider as unknown as {
      stripe: {
        invoices: { retrieve: ReturnType<typeof vi.fn> };
        checkout: { sessions: { list: ReturnType<typeof vi.fn> } };
      };
    }
  ).stripe;
  stripe.invoices.retrieve = vi.fn().mockResolvedValue({
    id: 'in_http_test',
    payment_intent: 'pi_http_test',
  });
  stripe.checkout.sessions.list = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'cs_http_test',
        customer: 'cus_http_test',
        metadata: {
          priceId: 'price_http_test',
          userId: 'user_http_test',
        },
        mode: 'payment',
      },
    ],
  });
  return stripe;
}

describe('Stripe webhook HTTP route', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_http_route_key';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    dbMocks.insert.mockReturnValue({ values: dbMocks.values });
    dbMocks.values.mockResolvedValue(undefined);
    dbMocks.select.mockReturnValue({ from: dbMocks.from });
    dbMocks.from.mockReturnValue({ where: dbMocks.where });
    dbMocks.where.mockReturnValue({ orderBy: dbMocks.orderBy });
    dbMocks.orderBy.mockReturnValue({ limit: dbMocks.limit });
    dbMocks.limit.mockResolvedValue([]);
  });

  test('acknowledges a successfully processed signed event', async () => {
    const response = await handleStripeWebhookRequest(
      signedCheckoutRequest(),
      dependencies(new StripeProvider())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  test('rejects an invalid Stripe signature without requesting a retry', async () => {
    const request = new Request('https://example.com/api/webhooks/stripe', {
      method: 'POST',
      body: '{"id":"evt_invalid"}',
      headers: { 'stripe-signature': 'invalid' },
    });

    const response = await handleStripeWebhookRequest(
      request,
      dependencies(new StripeProvider())
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid Stripe signature',
    });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  test('requests a Stripe retry after a temporary processing failure', async () => {
    dbMocks.values.mockRejectedValueOnce(
      new Error('D1_ERROR: temporary database unavailable')
    );

    const response = await handleStripeWebhookRequest(
      signedCheckoutRequest(),
      dependencies(new StripeProvider())
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Webhook processing failed',
    });
  });

  test('acknowledges a successful retry after a temporary failure', async () => {
    dbMocks.values.mockRejectedValueOnce(
      new Error('D1_ERROR: temporary database unavailable')
    );
    const provider = new StripeProvider();

    const failedResponse = await handleStripeWebhookRequest(
      signedCheckoutRequest(),
      dependencies(provider)
    );
    const retryResponse = await handleStripeWebhookRequest(
      signedCheckoutRequest(),
      dependencies(provider)
    );

    expect(failedResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
    expect(dbMocks.values).toHaveBeenCalledTimes(2);
  });

  test('acknowledges a safely handled duplicate delivery', async () => {
    dbMocks.values
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error('D1_ERROR: UNIQUE constraint failed: payment.invoice_id')
      );
    const provider = new StripeProvider();

    const firstResponse = await handleStripeWebhookRequest(
      signedCheckoutRequest(),
      dependencies(provider)
    );
    const duplicateResponse = await handleStripeWebhookRequest(
      signedCheckoutRequest(),
      dependencies(provider)
    );

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(dbMocks.values).toHaveBeenCalledTimes(2);
  });

  test('acknowledges invoice.paid on its first delivery when checkout has not arrived', async () => {
    const provider = new StripeProvider();
    configureInvoiceRecovery(provider);

    const response = await handleStripeWebhookRequest(
      signedInvoiceRequest(),
      dependencies(provider)
    );

    expect(response.status).toBe(200);
    // findPaymentRecord (invoiceId) plus the reconstruct sessionId lookup.
    expect(dbMocks.limit).toHaveBeenCalledTimes(2);
    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        paid: true,
        sessionId: 'cs_http_test',
      })
    );
  });

  test('requests a retry for a temporary Stripe recovery failure and succeeds later', async () => {
    const provider = new StripeProvider();
    const stripe = configureInvoiceRecovery(provider);
    stripe.checkout.sessions.list
      .mockRejectedValueOnce(new Error('Stripe API temporarily unavailable'))
      .mockResolvedValueOnce({
        data: [
          {
            id: 'cs_http_test',
            customer: 'cus_http_test',
            metadata: {
              priceId: 'price_http_test',
              userId: 'user_http_test',
            },
            mode: 'payment',
          },
        ],
      });

    const failedResponse = await handleStripeWebhookRequest(
      signedInvoiceRequest(),
      dependencies(provider)
    );
    const retryResponse = await handleStripeWebhookRequest(
      signedInvoiceRequest(),
      dependencies(provider)
    );

    expect(failedResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
  });
});
