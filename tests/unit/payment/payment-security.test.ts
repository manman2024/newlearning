import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getPaymentProvider: vi.fn(),
  createCheckout: vi.fn(),
  createCustomerPortal: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      middleware: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock('@/middlewares/auth-middleware', () => ({ authApiMiddleware: {} }));
vi.mock('@/db', () => ({ getDb: mocks.getDb }));
vi.mock('@/payment', () => ({
  getPaymentProvider: mocks.getPaymentProvider,
  createCheckout: mocks.createCheckout,
  createCustomerPortal: mocks.createCustomerPortal,
}));
vi.mock('@/lib/locale', () => ({ getLocale: () => 'en' }));
vi.mock('@/lib/urls', () => ({
  getBaseUrl: () => 'https://example.test',
  getCanonicalUrl: (path: string) => `https://example.test${path}`,
}));
vi.mock('@/lib/price-plan', () => ({
  findPlanByPriceId: vi.fn(),
  getAllPricePlans: vi.fn(),
}));

import {
  checkPaymentCompletion,
  createCheckoutSession,
  createCustomerPortalSession,
} from '@/api/payment';

type ServerInput = {
  data: Record<string, unknown>;
  context: { userId: string };
};

const checkout = createCheckoutSession as unknown as (
  input: ServerInput
) => Promise<{ id: string; url: string }>;
const portal = createCustomerPortalSession as unknown as (
  input: ServerInput
) => Promise<{ url: string }>;
const completion = checkPaymentCompletion as unknown as (
  input: ServerInput
) => Promise<{ isPaid: boolean }>;

const client = createClient({ url: ':memory:' });
const db = drizzle(client);

describe('payment security boundaries', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await client.executeMultiple(`
      DROP TABLE IF EXISTS payment;
      DROP TABLE IF EXISTS user;
      CREATE TABLE user (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        customer_id TEXT
      );
      CREATE TABLE payment (
        id TEXT PRIMARY KEY,
        price_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        subscription_id TEXT,
        session_id TEXT,
        invoice_id TEXT,
        type TEXT NOT NULL,
        scene TEXT,
        interval TEXT,
        status TEXT NOT NULL,
        paid INTEGER NOT NULL,
        period_start INTEGER,
        period_end INTEGER,
        cancel_at_period_end INTEGER,
        trial_start INTEGER,
        trial_end INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO user VALUES
        ('user_a', 'User A', 'a@example.test', 'cus_a'),
        ('user_b', 'User B', 'b@example.test', 'cus_b');
    `);
    mocks.getDb.mockReturnValue(db);
    mocks.getPaymentProvider.mockReturnValue({});
    mocks.createCheckout.mockResolvedValue({
      id: 'cs_created',
      url: 'https://checkout.stripe.com/c/pay/cs_created',
    });
    mocks.createCustomerPortal.mockResolvedValue({
      url: 'https://billing.stripe.com/session',
    });
  });

  afterAll(() => client.close());

  test.each([
    [
      'success URL',
      { successUrl: 'https://attacker.example/payment-complete' },
    ],
    ['cancel URL', { cancelUrl: '//attacker.example/payment-canceled' }],
  ])('rejects an external checkout %s', async (_name, urls) => {
    await expect(
      checkout({
        context: { userId: 'user_a' },
        data: {
          planId: 'pro',
          priceId: 'price_monthly',
          ...urls,
        },
      })
    ).rejects.toThrow('Payment return URL must use the application origin');
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  test.each([
    'https://attacker.example/account',
    '//attacker.example/account',
    'https://sub.example.test/account',
    'http://example.test/account',
    'https://example.test:444/account',
  ])('rejects an untrusted Customer Portal return URL: %s', async (returnUrl) => {
    await expect(
      portal({
        context: { userId: 'user_a' },
        data: { returnUrl },
      })
    ).rejects.toThrow('Payment return URL must use the application origin');
    expect(mocks.createCustomerPortal).not.toHaveBeenCalled();
  });

  test('normalizes trusted payment return URLs', async () => {
    await checkout({
      context: { userId: 'user_a' },
      data: {
        planId: 'pro',
        priceId: 'price_monthly',
        successUrl: '/settings/payment?complete=true',
        cancelUrl: 'pricing',
      },
    });
    await portal({
      context: { userId: 'user_a' },
      data: { returnUrl: 'https://example.test:443/settings/billing' },
    });

    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: 'https://example.test/settings/payment?complete=true',
        cancelUrl: 'https://example.test/pricing',
      })
    );
    expect(mocks.createCustomerPortal).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: 'https://example.test/settings/billing',
      })
    );
  });

  test('creates an unforgeable order reference for hosted checkout polling', async () => {
    mocks.getPaymentProvider.mockReturnValue({
      hostsPostCheckoutPage: true,
    });

    await checkout({
      context: { userId: 'user_a' },
      data: {
        planId: 'pro',
        priceId: 'price_monthly',
        metadata: { paymentReference: 'forged_reference' },
      },
    });

    const params = mocks.createCheckout.mock.calls[0][0];
    const paymentReference = params.metadata.paymentReference;
    expect(paymentReference).not.toBe('forged_reference');
    expect(paymentReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    const successUrl = new URL(params.successUrl);
    expect(successUrl.pathname).toBe('/settings/payment');
    expect(successUrl.searchParams.get('checkout_id')).toBe(paymentReference);
    expect(successUrl.searchParams.get('callback')).toBe('/settings/billing');
  });

  test('does not reveal another user payment through its session ID', async () => {
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO payment (
        id, price_id, user_id, customer_id, session_id, type, scene,
        status, paid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'payment_b',
        'price_monthly',
        'user_b',
        'cus_b',
        'cs_user_b',
        'subscription',
        'subscription',
        'active',
        1,
        now,
        now,
      ],
    });

    await expect(
      completion({
        context: { userId: 'user_a' },
        data: { sessionId: 'cs_user_b' },
      })
    ).resolves.toEqual({ isPaid: false });
    await expect(
      completion({
        context: { userId: 'user_b' },
        data: { sessionId: 'cs_user_b' },
      })
    ).resolves.toEqual({ isPaid: true });
  });

  test('reports a checkout as paid when a duplicate pending row also exists', async () => {
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO payment (
        id, price_id, user_id, customer_id, subscription_id, session_id,
        invoice_id, type, scene, status, paid, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'pending_payment',
        'price_monthly',
        'user_a',
        'cus_a',
        'sub_duplicate',
        'cs_duplicate',
        'in_duplicate',
        'subscription',
        'subscription',
        'active',
        0,
        now,
        now,
        'paid_payment',
        'price_monthly',
        'user_a',
        'cus_a',
        'sub_duplicate',
        'cs_duplicate',
        'in_duplicate',
        'subscription',
        'subscription',
        'active',
        1,
        now + 1,
        now + 1,
      ],
    });

    await expect(
      completion({
        context: { userId: 'user_a' },
        data: { sessionId: 'cs_duplicate' },
      })
    ).resolves.toEqual({ isPaid: true });
  });

  test.each([
    'cs_forged',
    'cs_missing',
  ])('does not report an unknown session %s as paid', async (sessionId) => {
    await expect(
      completion({
        context: { userId: 'user_a' },
        data: { sessionId },
      })
    ).resolves.toEqual({ isPaid: false });
  });

  test('does not treat an older paid order as completion of a new checkout', async () => {
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO payment (
        id, price_id, user_id, customer_id, session_id, type, scene,
        status, paid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'older_payment',
        'price_monthly',
        'user_a',
        'cus_a',
        'older_checkout_reference',
        'subscription',
        'subscription',
        'active',
        1,
        now,
        now,
      ],
    });

    await expect(
      completion({
        context: { userId: 'user_a' },
        data: { sessionId: 'new_checkout_reference' },
      })
    ).resolves.toEqual({ isPaid: false });
  });
});
