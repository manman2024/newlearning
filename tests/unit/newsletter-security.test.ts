import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSession: vi.fn(),
  isSubscribed: vi.fn(),
  unsubscribe: vi.fn(),
  deleteCache: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
  createMiddleware: () => ({ server: (handler: unknown) => handler }),
  createServerFn: () => {
    let middleware: (input: unknown) => unknown;
    const builder = {
      validator: () => builder,
      middleware: (handlers: Array<typeof middleware>) => {
        [middleware] = handlers;
        return builder;
      },
      handler:
        (handler: (input: unknown) => unknown) =>
        (input: Record<string, unknown> = {}) =>
          middleware({
            next: ({ context }: { context: unknown }) =>
              handler({ ...input, context }),
          }),
    };
    return builder;
  },
}));
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}));
vi.mock('@/auth/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('@/db', () => ({ getDb: mocks.getDb }));
vi.mock('@/config/website', () => ({
  websiteConfig: { auth: { enable: true }, newsletter: { enable: true } },
}));
vi.mock('@/mail', () => ({ sendEmail: vi.fn() }));
vi.mock('@/newsletter', () => ({
  isSubscribed: mocks.isSubscribed,
  subscribe: vi.fn(),
  unsubscribe: mocks.unsubscribe,
}));
vi.mock('@/cache', () => ({
  CACHE_TTL: { newsletterStatus: 60 },
  createCacheKey: (prefix: string, email: string) => `${prefix}:${email}`,
  deleteCache: mocks.deleteCache,
  getOrSetCache: ({ fetcher }: { fetcher: () => unknown }) => fetcher(),
}));

import { getNewsletterStatus, unsubscribeNewsletter } from '@/api/newsletter';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const functions = [getNewsletterStatus, unsubscribeNewsletter];

beforeEach(async () => {
  vi.clearAllMocks();
  await client.executeMultiple(`
    DROP TABLE IF EXISTS user;
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL);
    INSERT INTO user VALUES ('owner', 'owner@example.test');
    INSERT INTO user VALUES ('other', 'other@example.test');
  `);
  mocks.getDb.mockReturnValue(db);
  mocks.getSession.mockResolvedValue({
    user: { id: 'owner', emailVerified: true },
  });
  mocks.isSubscribed.mockResolvedValue(true);
  mocks.unsubscribe.mockResolvedValue(true);
});
afterAll(() => client.close());

for (const [index, fn] of functions.entries()) {
  const call = fn as unknown as (input?: unknown) => Promise<unknown>;
  test(`operation ${index}: anonymous requests are rejected`, async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = (await call()) as Response;
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.isSubscribed).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
  test(`operation ${index}: unverified requests are rejected`, async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'owner', emailVerified: false },
    });
    const response = (await call()) as Response;
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  test(`operation ${index}: supplied email cannot select another user`, async () => {
    await call({ data: { email: 'other@example.test' } });
    const provider = index === 0 ? mocks.isSubscribed : mocks.unsubscribe;
    expect(provider).toHaveBeenCalledExactlyOnceWith('owner@example.test');
    if (index === 1) {
      expect(mocks.deleteCache).toHaveBeenCalledExactlyOnceWith(
        'newsletter:status:owner@example.test'
      );
    }
  });
  test(`operation ${index}: missing user fails before contacting provider`, async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'missing', emailVerified: true },
    });
    await expect(call()).rejects.toThrow('User email not found');
    expect(mocks.isSubscribed).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
}
