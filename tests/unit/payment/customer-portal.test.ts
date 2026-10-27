import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getPaymentProvider: vi.fn(),
  createCustomerPortal: vi.fn(),
}));

// Execute the application's handler with a trusted middleware context. Auth
// transport and field permissions are covered through real endpoints in E2E.
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
  createCustomerPortal: mocks.createCustomerPortal,
  createCheckout: vi.fn(),
}));
vi.mock('@/lib/locale', () => ({ getLocale: () => 'en' }));
vi.mock('@/lib/urls', () => ({
  getCanonicalUrl: (path: string) => `https://example.test${path}`,
}));
vi.mock('@/lib/price-plan', () => ({
  findPlanByPriceId: vi.fn(),
  getAllPricePlans: vi.fn(),
}));

import { createCustomerPortalSession } from '@/api/payment';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const portal = createCustomerPortalSession as unknown as (input: {
  data: Record<string, unknown>;
  context: { userId: string };
}) => Promise<{ url: string }>;

describe('customer portal ownership', () => {
  beforeEach(async () => {
    await client.executeMultiple(`
      DROP TABLE IF EXISTS user;
      CREATE TABLE user (id TEXT PRIMARY KEY, customer_id TEXT);
      INSERT INTO user VALUES ('user_b', 'cus_b');
      INSERT INTO user VALUES ('user_a', 'cus_a');
      INSERT INTO user VALUES ('user_without_customer', NULL);
    `);
    mocks.getDb.mockReturnValue(db);
    mocks.getPaymentProvider.mockReturnValue({});
    mocks.createCustomerPortal.mockResolvedValue({
      url: 'https://billing.example.test/session',
    });
  });

  afterAll(() => client.close());

  test.each([
    ['user_a', 'cus_a'],
    ['user_b', 'cus_b'],
  ])('uses the stored customer mapping for %s', async (userId, customerId) => {
    await expect(
      portal({
        context: { userId },
        data: { userId: 'user_b', customerId: 'cus_injected' },
      })
    ).resolves.toEqual({ url: 'https://billing.example.test/session' });

    expect(mocks.createCustomerPortal).toHaveBeenCalledExactlyOnceWith({
      customerId,
      returnUrl: 'https://example.test/settings/billing',
      locale: 'en',
    });
  });

  test.each([
    'user_without_customer',
    'missing_user',
  ])('rejects %s when the provider requires a customer ID', async (userId) => {
    await expect(
      portal({
        context: { userId },
        data: { customerId: 'cus_b' },
      })
    ).rejects.toThrow('No customer found for user');
    expect(mocks.createCustomerPortal).not.toHaveBeenCalled();
  });

  test('keeps shared portals available for providers without customer IDs', async () => {
    mocks.getPaymentProvider.mockReturnValue({ requiresCustomerId: false });

    await portal({ context: { userId: 'user_without_customer' }, data: {} });

    expect(mocks.createCustomerPortal).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: '' })
    );
  });
});
