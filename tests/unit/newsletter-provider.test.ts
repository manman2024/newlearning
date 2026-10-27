import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { NewsletterConfig } from '@/types';

const mocks = vi.hoisted(() => ({
  newsletter: {
    enable: true,
    provider: 'mailcheap',
  } as NewsletterConfig,
  env: {} as Record<string, string>,
}));

vi.mock('@/config/website', () => ({
  websiteConfig: { newsletter: mocks.newsletter },
}));
vi.mock('@/env/server', () => ({ serverEnv: mocks.env }));

beforeEach(() => {
  vi.resetModules();
  mocks.newsletter.enable = true;
  mocks.newsletter.provider = 'mailcheap';
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, {
    MAILCHEAP_API_KEY: 'mc_test',
    MAILCHEAP_NEWSLETTER_ID: 'weekly',
  });
});

afterEach(() => vi.unstubAllGlobals());

test('the module routes signup, unsubscribe and re-subscription through MailCheap', async () => {
  let active = false;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') active = true;
      if (options?.method === 'PATCH') active = false;
      return new Response(
        JSON.stringify({
          id: 'contact',
          status: active ? 'active' : 'unsubscribed',
        })
      );
    });
  vi.stubGlobal('fetch', fetcher);
  const { getNewsletterProvider, isSubscribed, subscribe, unsubscribe } =
    await import('@/newsletter');
  expect(getNewsletterProvider().getProviderName()).toBe('mailcheap');
  expect(getNewsletterProvider()).toBe(getNewsletterProvider());
  expect(await isSubscribed('owner@example.test')).toBe(false);
  expect(await subscribe('owner@example.test')).toBe(true);
  expect(await isSubscribed('owner@example.test')).toBe(true);
  expect(await unsubscribe('owner@example.test')).toBe(true);
  expect(await isSubscribed('owner@example.test')).toBe(false);
  expect(await subscribe('owner@example.test')).toBe(true);
  expect(await isSubscribed('owner@example.test')).toBe(true);
});

test('the feature gate prevents initialization without credentials when disabled', async () => {
  mocks.newsletter.enable = false;
  delete mocks.env.MAILCHEAP_API_KEY;
  delete mocks.env.MAILCHEAP_NEWSLETTER_ID;
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const { isSubscribed, subscribe, unsubscribe } = await import('@/newsletter');
  expect(await subscribe('owner@example.test')).toBe(false);
  expect(await isSubscribed('owner@example.test')).toBe(false);
  expect(await unsubscribe('owner@example.test')).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  'resend',
  'beehiiv',
] as const)('existing %s provider works without MailCheap credentials', async (name) => {
  mocks.newsletter.provider = name;
  delete mocks.env.MAILCHEAP_API_KEY;
  delete mocks.env.MAILCHEAP_NEWSLETTER_ID;
  Object.assign(mocks.env, {
    RESEND_API_KEY: 're_test',
    BEEHIIV_API_KEY: 'beehiiv_test',
    BEEHIIV_PUBLICATION_ID: 'publication_test',
  });
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const { getNewsletterProvider } = await import('@/newsletter');
  expect(getNewsletterProvider().getProviderName()).toBe(name);
  expect(fetcher).not.toHaveBeenCalled();
});
