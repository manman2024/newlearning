import { createServer } from 'node:http';
import { expect, test, vi } from 'vitest';

vi.mock('@/env/server', () => ({ serverEnv: {} }));
vi.mock('@/lib/observability', () => ({
  logOperationalEvent: { error: vi.fn() },
}));

import { MailCheapClient } from '@/newsletter/provider/mailcheap';

const cases = [
  ['GET', 301],
  ['GET', 302],
  ['GET', 303],
  ['GET', 307],
  ['GET', 308],
  ['POST', 307],
  ['POST', 308],
  ['PATCH', 307],
  ['PATCH', 308],
] as const;

test.each(
  cases
)('%s follows HTTP %s with native fetch defaults', async (method, status) => {
  const received: { method: string; body: string; path: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk.toString();
    received.push({
      method: request.method!,
      body,
      path: request.url!,
    });
    if (!request.url?.startsWith('/destination/')) {
      response.writeHead(status, {
        Location: `/destination${request.url}`,
      });
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'contact', status: 'active' }));
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    const fetcher: typeof fetch = (input, options) => {
      expect(options).not.toHaveProperty('redirect');
      const url = new URL(String(input));
      return fetch(
        `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
        options
      );
    };
    const client = new MailCheapClient('mc_test', 'weekly', fetcher);
    if (method === 'GET') {
      expect(await client.contact('owner@example.test')).toEqual({
        id: 'contact',
        status: 'active',
      });
    } else if (method === 'POST') {
      expect(await client.signup('owner@example.test')).toEqual({
        id: 'contact',
        status: 'active',
      });
    } else {
      await client.unsubscribe('contact');
    }
    expect(received).toHaveLength(2);
    const [original, destination] = received;
    expect(destination).toEqual({
      method,
      body: original.body,
      path: `/destination${original.path}`,
    });
    if (method !== 'GET') {
      expect(JSON.parse(destination.body)).toMatchObject({
        newsletter: 'weekly',
        ...(method === 'POST'
          ? { email: 'owner@example.test', resubscribe: true }
          : { status: 'unsubscribed' }),
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
