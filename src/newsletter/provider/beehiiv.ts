import { serverEnv } from '@/env/server';
import type {
  CheckSubscribeStatusParams,
  NewsletterProvider,
  SubscribeNewsletterParams,
  UnsubscribeNewsletterParams,
} from '@/newsletter/types';
import { BeehiivClient } from '@beehiiv/sdk';
import { logOperationalEvent } from '@/lib/observability';

/**
 * Beehiiv newsletter provider
 *
 * Beehiiv is a newsletter platform that provides:
 * - Subscription management via API
 * - Publication-based subscriber organization
 * - Rich subscriber data with custom fields
 *
 * docs:
 * https://developers.beehiiv.com/
 * https://github.com/beehiiv/typescript-sdk
 */
export class BeehiivNewsletterProvider implements NewsletterProvider {
  private client: BeehiivClient;
  private publicationId: string;

  constructor() {
    const apiKey = serverEnv.BEEHIIV_API_KEY;
    const publicationId = serverEnv.BEEHIIV_PUBLICATION_ID;

    if (!apiKey) {
      throw new Error('BEEHIIV_API_KEY is required for newsletter.');
    }
    if (!publicationId) {
      throw new Error('BEEHIIV_PUBLICATION_ID is required for newsletter.');
    }

    this.client = new BeehiivClient({ token: apiKey });
    this.publicationId = publicationId;
  }

  getProviderName(): string {
    return 'beehiiv';
  }

  /**
   * Subscribe a user to the newsletter.
   * Creates a new subscription or reactivates an existing one.
   */
  async subscribe({ email }: SubscribeNewsletterParams): Promise<boolean> {
    try {
      const existing = await this.getSubscription(email);

      if (existing) {
        if (existing.status !== 'active') {
          const updateResult = await this.client.subscriptions.patch(
            this.publicationId,
            existing.id,
            {}
          );

          await this.client.bulkSubscriptionUpdates.patchStatus(
            this.publicationId,
            {
              subscription_ids: [existing.id],
              new_status: 'active',
            }
          );

          logOperationalEvent.log('Reactivated subscription', email);
          return !!updateResult;
        }

        logOperationalEvent.log('Subscription already active', email);
        return true;
      }

      const result = await this.client.subscriptions.create(
        this.publicationId,
        {
          email,
          reactivate_existing: true,
          send_welcome_email: false,
        }
      );

      if (!result.data) {
        logOperationalEvent.error('Error creating subscription', email);
        return false;
      }

      logOperationalEvent.log('Created new subscription', email);
      return true;
    } catch (error) {
      logOperationalEvent.error('Error subscribing to newsletter', error);
      return false;
    }
  }

  /**
   * Unsubscribe a user from the newsletter.
   */
  async unsubscribe({ email }: UnsubscribeNewsletterParams): Promise<boolean> {
    try {
      const subscription = await this.getSubscription(email);

      if (!subscription) {
        logOperationalEvent.log(
          'Subscription not found for unsubscribe',
          email
        );
        return true;
      }

      await this.client.bulkSubscriptionUpdates.patch(this.publicationId, {
        subscriptions: [
          {
            subscription_id: subscription.id,
            unsubscribe: true,
          },
        ],
      });

      logOperationalEvent.log('Unsubscribed from newsletter', email);
      return true;
    } catch (error) {
      logOperationalEvent.error('Error unsubscribing from newsletter', error);
      return false;
    }
  }

  /**
   * Check if a user is subscribed to the newsletter.
   */
  async checkSubscribeStatus({
    email,
  }: CheckSubscribeStatusParams): Promise<boolean> {
    try {
      const subscription = await this.getSubscription(email);

      if (!subscription) {
        logOperationalEvent.log('Subscription not found:', email);
        return false;
      }

      const isActive = subscription.status === 'active';
      logOperationalEvent.log(
        'Check subscribe status:',
        `${email} ${isActive}`
      );
      return isActive;
    } catch (error) {
      logOperationalEvent.error('Error checking subscribe status:', error);
      return false;
    }
  }

  /**
   * Get subscription by email.
   */
  private async getSubscription(email: string) {
    try {
      const result = await this.client.subscriptions.getByEmail(
        this.publicationId,
        email
      );

      return result.data ?? null;
    } catch (_error) {
      return null;
    }
  }
}
