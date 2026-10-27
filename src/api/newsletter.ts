import { createServerFn } from '@tanstack/react-start';
import { CACHE_TTL, createCacheKey, deleteCache, getOrSetCache } from '@/cache';
import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { user } from '@/db/auth.schema';
import { authApiMiddleware } from '@/middlewares/auth-middleware';
import { eq } from 'drizzle-orm';
import { sendEmail } from '@/mail';
import { isSubscribed, subscribe, unsubscribe } from '@/newsletter';
import { z } from 'zod';
import { logOperationalEvent } from '@/lib/observability';

const emailSchema = z.email('Please enter a valid email address');

function ensureNewsletterEnabled(): void {
  if (!websiteConfig.newsletter?.enable) {
    throw new Error('Newsletter is disabled');
  }
}

function getNewsletterStatusCacheKey(email: string): string {
  return createCacheKey('newsletter:status', email.trim().toLowerCase());
}

async function getUserEmail(userId: string): Promise<string> {
  const [record] = await getDb()
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!record?.email) throw new Error('User email not found');
  return record.email.trim().toLowerCase();
}

export const getNewsletterStatus = createServerFn({ method: 'GET' })
  .middleware([authApiMiddleware])
  .handler(async ({ context }) => {
    ensureNewsletterEnabled();
    const email = await getUserEmail(context.userId);
    try {
      return getOrSetCache({
        key: getNewsletterStatusCacheKey(email),
        ttlSeconds: CACHE_TTL.newsletterStatus,
        fetcher: async () => {
          const subscribed = await isSubscribed(email);
          return { subscribed };
        },
      });
    } catch (error) {
      logOperationalEvent.error('Check newsletter status error:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Something went wrong'
      );
    }
  });

export const subscribeNewsletter = createServerFn({ method: 'POST' })
  .validator(z.object({ email: emailSchema }))
  .handler(async ({ data }) => {
    ensureNewsletterEnabled();
    const email = data.email.trim().toLowerCase();
    try {
      const ok = await subscribe(email);
      if (!ok) {
        throw new Error('Failed to subscribe to the newsletter');
      }
      await deleteCache(getNewsletterStatusCacheKey(email));
      if (websiteConfig.mail?.fromEmail) {
        // Wait for 3 seconds to ensure the newsletter is subscribed
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await sendEmail({
            to: email,
            template: 'subscribeNewsletter',
            context: { email },
          });
        } catch (e) {
          logOperationalEvent.error('Newsletter welcome email error:', e);
        }
      }
    } catch (error) {
      logOperationalEvent.error('Subscribe newsletter error:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Something went wrong'
      );
    }
  });

export const unsubscribeNewsletter = createServerFn({ method: 'POST' })
  .middleware([authApiMiddleware])
  .handler(async ({ context }) => {
    ensureNewsletterEnabled();
    const email = await getUserEmail(context.userId);
    try {
      const ok = await unsubscribe(email);
      if (!ok) {
        throw new Error('Failed to unsubscribe from the newsletter');
      }
      await deleteCache(getNewsletterStatusCacheKey(email));
    } catch (error) {
      logOperationalEvent.error('Unsubscribe newsletter error:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Something went wrong'
      );
    }
  });
