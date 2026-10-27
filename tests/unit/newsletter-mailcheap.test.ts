import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/env/server', () => ({ serverEnv: {} }));
vi.mock('@/lib/observability', () => ({
  logOperationalEvent: { error: vi.fn() },
}));

import { logOperationalEvent } from '@/lib/observability';
import {
  MailCheapClient,
  MailCheapNewsletterProvider,
} from '@/newsletter/provider/mailcheap';

const fetcher = vi.fn<typeof fetch>();
const client = () => new MailCheapClient('mc_test', 'weekly', fetcher);
const provider = () => new MailCheapNewsletterProvider(client());
const email = 'owner@example.test';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

beforeEach(() => {
  fetcher.mockReset();
});

test.each([
  [undefined, 'weekly'],
  ['mc_test', undefined],
  ['', 'weekly'],
  ['mc_test', ''],
])('requires both server settings (%s, %s)', (key, newsletter) => {
  expect(() => new MailCheapClient(key, newsletter, fetcher)).toThrow(
    'Configure MAILCHEAP_API_KEY and MAILCHEAP_NEWSLETTER_ID'
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test('creates or reactivates a contact in the configured newsletter', async () => {
  fetcher.mockResolvedValueOnce(json({ id: 'contact', status: 'active' }, 201));
  expect(await provider().subscribe({ email: ' Owner@Example.test ' })).toBe(
    true
  );
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://mailcheap.ai/api/v1/contacts');
  expect(options).toMatchObject({
    method: 'POST',
    headers: {
      Authorization: 'Bearer mc_test',
      'Content-Type': 'application/json',
    },
    signal: expect.any(AbortSignal),
  });
  expect(JSON.parse(String(options?.body))).toEqual({
    newsletter: 'weekly',
    email,
    source: 'website',
    resubscribe: true,
  });
});

test.each([
  ['active', true],
  ['pending', false],
  ['unsubscribed', false],
  ['bounced', false],
  ['complained', false],
  ['dormant', false],
] as const)('only active contacts count as subscribed: %s', async (status, subscribed) => {
  fetcher.mockImplementation(async () => json({ id: 'contact', status }));
  expect(await provider().subscribe({ email })).toBe(subscribed);
  expect(await provider().checkSubscribeStatus({ email })).toBe(subscribed);
});

test('looks up normalized exact email and unsubscribes by contact ID', async () => {
  fetcher
    .mockResolvedValueOnce(json({ id: 'c/1', status: 'active' }))
    .mockResolvedValueOnce(json({ id: 'c/1', status: 'unsubscribed' }));
  expect(
    await provider().unsubscribe({ email: ' Owner+tag@Example.test ' })
  ).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://mailcheap.ai/api/v1/contacts/owner%2Btag%40example.test?newsletter=weekly'
  );
  const [url, options] = fetcher.mock.calls[1];
  expect(url).toBe('https://mailcheap.ai/api/v1/contacts/c%2F1');
  expect(options?.method).toBe('PATCH');
  expect(JSON.parse(String(options?.body))).toEqual({
    newsletter: 'weekly',
    status: 'unsubscribed',
  });
});

test('encodes newsletter scope separately from the contact path', async () => {
  fetcher.mockResolvedValueOnce(json({ id: 'contact', status: 'active' }));
  await new MailCheapClient('mc_test', 'weekly & news', fetcher).contact(email);
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://mailcheap.ai/api/v1/contacts/owner%40example.test?newsletter=weekly+%26+news'
  );
});

test('a missing contact is unsubscribed without a mutation', async () => {
  fetcher.mockImplementation(async () =>
    json({ error: { code: 'not_found' } }, 404)
  );
  expect(await provider().unsubscribe({ email })).toBe(true);
  expect(await provider().checkSubscribeStatus({ email })).toBe(false);
  expect(
    fetcher.mock.calls.every(([, options]) => options?.method === 'GET')
  ).toBe(true);
});

test.each([
  401, 402, 403, 429, 500,
])('provider errors (%s) fail safely without logging credentials or response bodies', async (status) => {
  fetcher.mockImplementation(async () =>
    json(
      { error: { code: 'request_failed', message: 'mc_test private' } },
      status
    )
  );
  expect(await provider().subscribe({ email })).toBe(false);
  expect(await provider().unsubscribe({ email })).toBe(false);
  expect(await provider().checkSubscribeStatus({ email })).toBe(false);
  expect(logOperationalEvent.error).toHaveBeenCalled();
  expect(
    JSON.stringify(vi.mocked(logOperationalEvent.error).mock.calls)
  ).not.toMatch(/mc_test|private|owner@example/);
});

test('retries a failed read once', async () => {
  fetcher
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(json({ id: 'contact', status: 'active' }));
  expect(await provider().checkSubscribeStatus({ email })).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('does not repeat a signup after an uncertain network failure', async () => {
  fetcher.mockRejectedValue(new Error('connection lost after commit'));
  expect(await provider().subscribe({ email })).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('does not repeat an unsubscribe after a server failure', async () => {
  fetcher
    .mockResolvedValueOnce(json({ id: 'contact', status: 'active' }))
    .mockResolvedValueOnce(json({ error: { code: 'internal_error' } }, 500));
  expect(await provider().unsubscribe({ email })).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each([
  'not-json',
  JSON.stringify({}),
  JSON.stringify({ id: '', status: 'active' }),
  JSON.stringify({ id: 'contact', status: 'unexpected' }),
])('rejects malformed signup responses without retrying: %s', async (body) => {
  fetcher.mockResolvedValueOnce(new Response(body, { status: 201 }));
  expect(await provider().subscribe({ email })).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('bounds provider response size', async () => {
  fetcher.mockResolvedValueOnce(new Response('x'.repeat(2_000_001)));
  expect(await provider().subscribe({ email })).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test.each([
  401, 403, 429,
])('does not retry a non-JSON HTTP %s response', async (status) => {
  fetcher.mockImplementation(
    async () => new Response('Unavailable', { status })
  );
  expect(await provider().checkSubscribeStatus({ email })).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('an empty HTTP 404 still means the contact is absent', async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await provider().unsubscribe({ email })).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('a non-JSON HTTP 500 read retries once and can recover', async () => {
  fetcher
    .mockResolvedValueOnce(new Response('Unavailable', { status: 500 }))
    .mockResolvedValueOnce(json({ id: 'contact', status: 'active' }));
  expect(await provider().checkSubscribeStatus({ email })).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
