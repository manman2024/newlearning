import { createHmac } from 'node:crypto';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('creem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('creem')>();
  return {
    ...actual,
    Creem: class {
      checkouts = {
        create: mocks.createCheckout,
      };
    },
  };
});

vi.mock('@/db', () => ({
  getDb: () => dbMocks,
}));

vi.mock('@/notification', () => ({
  sendPaymentNotification: vi.fn(),
}));

import { CreemProvider } from '@/payment/provider/creem';
import { user } from '@/db/auth.schema';

const WEBHOOK_SECRET = 'whsec_test';
const SUBSCRIPTION_TIMESTAMP = '2026-09-05T00:00:00.000Z';

function createSubscriptionPayload(eventType: string): string {
  return JSON.stringify({
    id: `evt_${eventType.replace('.', '_')}`,
    eventType,
    created_at: Date.parse(SUBSCRIPTION_TIMESTAMP),
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
        created_at: SUBSCRIPTION_TIMESTAMP,
        updated_at: SUBSCRIPTION_TIMESTAMP,
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
        created_at: SUBSCRIPTION_TIMESTAMP,
        updated_at: SUBSCRIPTION_TIMESTAMP,
      },
      collection_method: 'charge_automatically',
      status: 'active',
      current_period_start_date: SUBSCRIPTION_TIMESTAMP,
      current_period_end_date: '2026-10-05T00:00:00.000Z',
      created_at: SUBSCRIPTION_TIMESTAMP,
      updated_at: SUBSCRIPTION_TIMESTAMP,
    },
  });
}

async function dispatchSubscriptionEvent(eventType: string) {
  const payload = createSubscriptionPayload(eventType);
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  await new CreemProvider().handleWebhookEvent(payload, signature);
}

describe('Creem provider boundary', () => {
  beforeEach(() => {
    process.env.CREEM_API_KEY = 'key_test';
    process.env.CREEM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    dbMocks.update.mockReset();
    dbMocks.insert.mockReset();
    mocks.createCheckout.mockReset();
    mocks.createCheckout.mockResolvedValue({
      id: 'CHK_test',
      checkoutUrl: 'https://checkout.creem.io/pay/CHK_test',
    });
  });

  test('creates a hosted Creem checkout session', async () => {
    const provider = new CreemProvider();

    await expect(
      provider.createCheckout({
        planId: 'pro',
        priceId: 'PROD_monthly',
        customerEmail: 'buyer@example.com',
        metadata: { paymentReference: 'checkout_ref' },
      })
    ).resolves.toEqual({
      id: 'CHK_test',
      url: 'https://checkout.creem.io/pay/CHK_test',
    });

    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'PROD_monthly',
        successUrl: '',
        requestId: 'checkout_ref',
        metadata: { paymentReference: 'checkout_ref' },
      })
    );
  });

  test('appends the site theme to the hosted checkout URL', async () => {
    const provider = new CreemProvider();

    const dark = await provider.createCheckout({
      planId: 'pro',
      priceId: 'PROD_monthly',
      customerEmail: 'buyer@example.com',
      theme: 'dark',
    });
    expect(dark.url).toBe('https://checkout.creem.io/pay/CHK_test?theme=dark');

    mocks.createCheckout.mockResolvedValue({
      id: 'CHK_test',
      checkoutUrl:
        'https://checkout.creem.io/pay/CHK_test?discount_code=LAUNCH50',
    });

    const light = await provider.createCheckout({
      planId: 'pro',
      priceId: 'PROD_monthly',
      customerEmail: 'buyer@example.com',
      theme: 'light',
    });
    expect(light.url).toBe(
      'https://checkout.creem.io/pay/CHK_test?discount_code=LAUNCH50&theme=light'
    );
  });

  test('backfills the metadata user customer ID from a signed completed checkout', async () => {
    const provider = new CreemProvider();
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const values = vi.fn().mockResolvedValue(undefined);
    dbMocks.update.mockReturnValue({ set });
    dbMocks.insert.mockReturnValue({ values });
    const timestamp = '2026-09-05T00:00:00.000Z';
    const payload = JSON.stringify({
      id: 'evt_checkout_completed',
      eventType: 'checkout.completed',
      created_at: Date.parse(timestamp),
      object: {
        id: 'CHK_test',
        mode: 'test',
        object: 'checkout',
        status: 'completed',
        request_id: 'checkout_dedup_key',
        metadata: {
          paymentReference: 'checkout_ref',
          userId: 'user_buyer',
        },
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
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    await provider.handleWebhookEvent(payload, signature);

    expect(dbMocks.update).toHaveBeenCalledExactlyOnceWith(user);
    expect(set).toHaveBeenCalledExactlyOnceWith({
      customerId: 'cus_creem_buyer',
      updatedAt: expect.any(Date),
    });
    expect(where).toHaveBeenCalledOnce();
    expect(
      new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0])
    ).toMatchObject({
      sql: '"user"."id" = ?',
      params: ['user_buyer'],
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_creem_buyer',
        userId: 'user_buyer',
        paid: true,
        sessionId: 'checkout_ref',
      })
    );
  });

  test('rejects an invalid signature with a typed error', async () => {
    const payload = JSON.stringify({
      id: 'evt_bad_signature',
      eventType: 'checkout.completed',
      created_at: 1_757_000_000,
      object: {},
    });

    await expect(
      new CreemProvider().handleWebhookEvent(payload, 'invalid-signature')
    ).rejects.toMatchObject({
      name: 'InvalidWebhookSignatureError',
      message: 'Invalid Creem webhook signature',
    });
  });

  test.each([
    ['subscription.expired', 'past_due'],
    ['subscription.unpaid', 'unpaid'],
  ])('maps %s to lifecycle state %s', async (eventType, status) => {
    const returning = vi.fn().mockResolvedValue([{ id: 'payment_creem' }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMocks.update.mockReturnValue({ set });

    await dispatchSubscriptionEvent(eventType);

    expect(set).toHaveBeenCalledExactlyOnceWith({
      status,
      updatedAt: expect.any(Date),
    });
    expect(where).toHaveBeenCalledOnce();
    expect(
      new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0])
    ).toMatchObject({
      sql: '"payment"."subscription_id" = ?',
      params: ['sub_creem_buyer'],
    });
  });

  test('retries subscription.paid when checkout.completed has not created its row', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'payment_creem' }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMocks.update.mockReturnValue({ set });

    await expect(
      dispatchSubscriptionEvent('subscription.paid')
    ).rejects.toThrow('Failed to handle Creem webhook event');
    await expect(
      dispatchSubscriptionEvent('subscription.paid')
    ).resolves.toBeUndefined();

    expect(returning).toHaveBeenCalledTimes(2);
  });

  test.each([
    'subscription.paid',
    'subscription.active',
    'subscription.update',
    'subscription.canceled',
    'subscription.scheduled_cancel',
    'subscription.expired',
    'subscription.past_due',
    'subscription.unpaid',
    'subscription.trialing',
    'subscription.paused',
  ])('does not acknowledge %s when its payment row is missing', async (eventType) => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMocks.update.mockReturnValue({ set });

    await expect(dispatchSubscriptionEvent(eventType)).rejects.toThrow(
      'Failed to handle Creem webhook event'
    );
  });
});
