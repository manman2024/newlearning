import { z } from 'zod';
import { serverEnv } from '@/env/server';
import { logOperationalEvent } from '@/lib/observability';
import type {
  CheckSubscribeStatusParams,
  NewsletterProvider,
  SubscribeNewsletterParams,
  UnsubscribeNewsletterParams,
} from '@/newsletter/types';

const contactSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    'active',
    'pending',
    'unsubscribed',
    'bounced',
    'complained',
    'dormant',
  ]),
});
const errorSchema = z.object({
  error: z.object({ code: z.string().regex(/^[a-z0-9_]{1,80}$/) }),
});
class MailCheapError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(`MailCheap ${status}: ${code}`);
  }
}

/** No mutation retries: a timeout, 5xx or malformed success can hide a commit. */
export class MailCheapClient {
  constructor(
    private readonly key = serverEnv.MAILCHEAP_API_KEY,
    public readonly newsletter = serverEnv.MAILCHEAP_NEWSLETTER_ID,
    private readonly fetcher: typeof fetch = (...args) =>
      globalThis.fetch(...args)
  ) {
    if (!key || !newsletter) {
      throw new Error(
        'Configure MAILCHEAP_API_KEY and MAILCHEAP_NEWSLETTER_ID'
      );
    }
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown
  ): Promise<unknown> {
    const attempts = method === 'GET' ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetcher(
          `https://mailcheap.ai/api/v1${path}`,
          {
            method,
            headers: {
              Authorization: `Bearer ${this.key}`,
              'Content-Type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
          }
        );
        // Bound remote responses, including an unexpectedly large error page.
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) {
              await reader.cancel();
              throw new Error('MailCheap response is too large');
            }
            chunks.push(value);
          }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        let data: unknown;
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          if (!response.ok) {
            throw new MailCheapError(response.status, 'request_failed');
          }
          throw new Error('MailCheap returned invalid JSON');
        }
        if (!response.ok) {
          const error = errorSchema.safeParse(data);
          const code = error.success ? error.data.error.code : 'request_failed';
          throw new MailCheapError(response.status, code);
        }
        return data;
      } catch (error) {
        if (
          attempt + 1 < attempts &&
          (!(error instanceof MailCheapError) || error.status >= 500)
        )
          continue;
        if (error instanceof MailCheapError) throw error;
        throw new Error('MailCheap response unavailable; refresh to reconcile');
      }
    }
    throw new Error('MailCheap request failed');
  }
  async contact(email: string) {
    try {
      return contactSchema.parse(
        await this.request(
          `/contacts/${encodeURIComponent(email.trim().toLowerCase())}?${new URLSearchParams({ newsletter: this.newsletter! })}`
        )
      );
    } catch (error) {
      if (error instanceof MailCheapError && error.status === 404) return null;
      throw error;
    }
  }
  async signup(email: string) {
    return contactSchema.parse(
      await this.request('/contacts', 'POST', {
        newsletter: this.newsletter,
        email: email.trim().toLowerCase(),
        source: 'website',
        resubscribe: true,
      })
    );
  }
  async unsubscribe(id: string) {
    await this.request(`/contacts/${encodeURIComponent(id)}`, 'PATCH', {
      newsletter: this.newsletter,
      status: 'unsubscribed',
    });
  }
}

/** MailCheap contact management: https://mailcheap.ai/docs/api#contacts */
export class MailCheapNewsletterProvider implements NewsletterProvider {
  constructor(private readonly client = new MailCheapClient()) {}
  getProviderName() {
    return 'mailcheap';
  }
  async subscribe({ email }: SubscribeNewsletterParams): Promise<boolean> {
    try {
      const contact = await this.client.signup(email);
      return contact.status === 'active';
    } catch {
      logOperationalEvent.error('MailCheap newsletter subscription failed');
      return false;
    }
  }
  async unsubscribe({ email }: UnsubscribeNewsletterParams): Promise<boolean> {
    try {
      const contact = await this.client.contact(email);
      if (contact) await this.client.unsubscribe(contact.id);
      return true;
    } catch {
      logOperationalEvent.error('MailCheap newsletter unsubscribe failed');
      return false;
    }
  }
  async checkSubscribeStatus({
    email,
  }: CheckSubscribeStatusParams): Promise<boolean> {
    try {
      const contact = await this.client.contact(email);
      return contact?.status === 'active';
    } catch {
      logOperationalEvent.error('MailCheap newsletter status check failed');
      return false;
    }
  }
}
