import {
  type CashierLanguage,
  verifyWebhook,
  WaffoPancake,
  WaffoPancakeError,
  type WebhookEvent,
  type WebhookEventData,
  WebhookEventType,
} from '@waffo/pancake-ts';
import { eq, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { findPlanByPlanId, findPriceInPlan } from '@/lib/price-plan';
import { sendPaymentNotification } from '@/notification';
import { InvalidWebhookSignatureError } from '@/payment/errors';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PaymentStatus,
  PlanInterval,
  PortalResult,
} from '../types';
import { PaymentScenes, PaymentTypes, PlanIntervals } from '../types';
import { logOperationalEvent } from '@/lib/observability';

export const WAFFO_CUSTOMER_PORTAL_URL =
  'https://pancake.waffo.ai/consumer/portal/login';

type WaffoEvent = WebhookEvent<WebhookEventData>;

/** Application locale → Waffo hosted checkout language. */
const WAFFO_LANGUAGES: Record<string, CashierLanguage> = {
  en: 'en',
  zh: 'zh-Hans',
};

type SubscriptionUpdate = {
  status?: PaymentStatus;
  cancelAtPeriodEnd?: boolean;
  paid?: boolean;
  /** Re-read priceId/interval from the event (plan upgrade or downgrade). */
  syncPlan?: boolean;
};

/**
 * Waffo Pancake payment provider for fixed-price template plans.
 */
export class WaffoProvider implements PaymentProvider {
  /** Waffo has no per-merchant customer records; the portal is a shared URL. */
  readonly requiresCustomerId = false;

  /** Waffo redirects buyers to its own confirmation page after payment. */
  readonly hostsPostCheckoutPage = true;

  private client: WaffoPancake;

  constructor() {
    const merchantId = process.env.WAFFO_MERCHANT_ID;
    const privateKey = process.env.WAFFO_PRIVATE_KEY;
    if (!merchantId) {
      throw new Error('WAFFO_MERCHANT_ID environment variable is not set');
    }
    if (!privateKey) {
      throw new Error('WAFFO_PRIVATE_KEY environment variable is not set');
    }
    this.client = new WaffoPancake({ merchantId, privateKey });
  }

  getProviderName(): string {
    return 'waffo';
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const plan = findPlanByPlanId(params.planId);
    if (!plan) throw new Error(`Plan with ID ${params.planId} not found`);
    const price = findPriceInPlan(params.planId, params.priceId);
    if (!price) {
      throw new Error(
        `Price ID ${params.priceId} not found in plan ${params.planId}`
      );
    }

    // Waffo exposes two checkout entry points:
    //   - `client.checkout.createSession(...)` — anonymous buyer flow.
    //   - `client.checkout.authenticated.create(...)` — signed-in buyer
    //     flow. Internally issues a JWT via `client.auth.issueSessionToken()`
    //     keyed by `buyerIdentity` and appends it to the checkout URL as a
    //     `#token=...` fragment. Waffo can then attribute the order to a
    //     specific merchant-side user and surface their history in the
    //     consumer portal.
    // We always run inside `authApiMiddleware` (see src/api/payment.ts), so
    // every checkout has a known userId and we prefer the authenticated
    // variant to preserve buyer attribution end-to-end.
    try {
      const metadata = {
        ...params.metadata,
        planId: params.planId,
        priceId: params.priceId,
      };
      const language = this.mapLocaleToWaffoLanguage(params.locale);
      // Only enable the trial when the local price plan actually declares
      // one. Waffo also honors the product-level trial setting when unset,
      // so omit the flag if we have no explicit signal from our side.
      const withTrial =
        typeof price.trialPeriodDays === 'number' && price.trialPeriodDays > 0
          ? true
          : undefined;
      const darkMode =
        params.theme === 'dark'
          ? true
          : params.theme === 'light'
            ? false
            : undefined;
      const result = await this.client.checkout.authenticated.create({
        // Merchant-stable buyer identifier baked into the JWT. Prefer userId
        // (stable across email changes) and fall back to email only if the
        // caller failed to attach it — email-based identity would create a
        // "new" Waffo buyer when the user updates their address.
        buyerIdentity: params.metadata?.userId ?? params.customerEmail,
        buyerEmail: params.customerEmail,
        currency: price.currency,
        metadata,
        // Order-scoped identifier inherited by the order, its payments and its
        // refunds — it must be unique per checkout, not per customer.
        orderMerchantExternalId:
          params.metadata?.paymentReference ?? crypto.randomUUID(),
        productId: params.priceId,
        successUrl: params.successUrl,
        ...(language ? { language } : {}),
        ...(withTrial !== undefined ? { withTrial } : {}),
        ...(darkMode !== undefined ? { darkMode } : {}),
      });

      return {
        id: result.sessionId,
        url: result.checkoutUrl,
      };
    } catch (error) {
      this.logError('create checkout', error);
      throw new Error('Failed to create Waffo checkout session');
    }
  }

  async createCustomerPortal(
    _params: CreatePortalParams
  ): Promise<PortalResult> {
    return { url: WAFFO_CUSTOMER_PORTAL_URL };
  }

  async handleWebhookEvent(payload: string, signature: string): Promise<void> {
    try {
      const expectedMode = this.getExpectedMode();
      // Verify against the environment we expect to be running in. Passing
      // an explicit `environment` avoids letting the SDK guess based on
      // headers. Waffo retries reuse the original signature timestamp, so the
      // 45-minute past-facing window matches the SDK retry schedule. Future
      // timestamps retain the SDK's stricter one-minute default.
      let event: WaffoEvent;
      try {
        event = verifyWebhook<WebhookEventData>(payload, signature, {
          environment: expectedMode,
          toleranceMs: 2_700_000,
        });
      } catch (error) {
        // Surface verification failures (bad signature, malformed header,
        // stale timestamp) as a typed error so the route can answer 400
        // instead of acknowledging a forged request with 200.
        this.logError('webhook signature verification', error);
        throw new InvalidWebhookSignatureError('Waffo');
      }
      if (event.mode !== expectedMode) {
        logOperationalEvent.warn(
          `Skipping Waffo ${event.mode} event in ${expectedMode} runtime: ${event.eventType}`
        );
        return;
      }
      switch (event.eventType) {
        case WebhookEventType.OrderCompleted:
          await this.createOneTimePayment(event);
          break;
        case WebhookEventType.SubscriptionActivated:
          await this.createSubscriptionPayment(event);
          break;
        case WebhookEventType.SubscriptionPaymentSucceeded:
          // Pure payment event: it deliberately carries no subscription
          // status or period. Lifecycle state is handled by activated,
          // renewed and recovered instead.
          break;
        case WebhookEventType.SubscriptionRenewed:
        case WebhookEventType.SubscriptionRecovered:
          await this.updateSubscription(event, { status: 'active' });
          break;
        case WebhookEventType.SubscriptionPlanChanged:
          await this.updateSubscription(event, { syncPlan: true });
          break;
        case WebhookEventType.SubscriptionCanceling:
          await this.updateSubscription(event, {
            status: 'active',
            cancelAtPeriodEnd: true,
          });
          break;
        case WebhookEventType.SubscriptionUncanceled:
          await this.updateSubscription(event, {
            status: 'active',
            cancelAtPeriodEnd: false,
          });
          break;
        case WebhookEventType.SubscriptionPastDue:
          await this.updateSubscription(event, { status: 'past_due' });
          break;
        case WebhookEventType.SubscriptionCanceled:
          await this.updateSubscription(event, {
            status: 'canceled',
            cancelAtPeriodEnd: false,
            paid: false,
          });
          break;
        case WebhookEventType.RefundSucceeded:
          await this.revokeRefundedPayment(event);
          break;
        case WebhookEventType.RefundFailed:
          logOperationalEvent.warn('Waffo refund failed:', event.eventId);
          break;
        default:
          logOperationalEvent.warn(
            `Unhandled Waffo webhook event: ${event.eventType}`
          );
      }
    } catch (error) {
      // Signature failures must reach the route unwrapped so it can answer
      // 400 instead of acknowledging a forged request with 200.
      if (error instanceof InvalidWebhookSignatureError) throw error;
      this.logError('webhook handling', error);
      throw new Error('Failed to handle Waffo webhook event');
    }
  }

  /**
   * Extract the structured fields Waffo attaches to API errors so operators
   * can tell why a call failed without diffing raw stack traces. Non-SDK
   * errors fall back to a plain string so the shape is unchanged.
   */
  private logError(context: string, error: unknown): void {
    if (error instanceof WaffoPancakeError) {
      logOperationalEvent.error(
        `Waffo ${context} error [status=${error.status}]:`,
        error.errors.map((e) => ({
          layer: e.layer,
          message: e.message,
          aiHint: e.aiHint,
        }))
      );
      return;
    }
    logOperationalEvent.error(`Waffo ${context} error:`, error);
  }

  /**
   * Waffo delivers `test` and `prod` events to the same endpoint, so a
   * production Worker must reject sandbox events or test purchases would grant
   * real access. Set WAFFO_DEBUG=true to accept test events in production.
   */
  private getExpectedMode(): 'test' | 'prod' {
    const useTestMode =
      !import.meta.env.PROD || process.env.WAFFO_DEBUG === 'true';
    return useTestMode ? 'test' : 'prod';
  }

  private getUserId(data: WebhookEventData): string | undefined {
    return data.orderMetadata?.userId ?? data.merchantProvidedBuyerIdentity;
  }

  /**
   * Waffo webhook payloads carry no productId, so the plan price is resolved
   * from the checkout metadata. Plan-change events must prefer product
   * metadata because order metadata can still describe the original checkout.
   */
  private getPriceId(
    data: WebhookEventData,
    preferProductMetadata = false
  ): string | undefined {
    return preferProductMetadata
      ? (data.productMetadata?.priceId ?? data.orderMetadata?.priceId)
      : (data.orderMetadata?.priceId ?? data.productMetadata?.priceId);
  }

  private getPaymentSessionId(data: WebhookEventData): string | null {
    return (
      data.orderMerchantExternalId ??
      data.orderMetadata?.paymentReference ??
      null
    );
  }

  private async createOneTimePayment(event: WaffoEvent): Promise<void> {
    const { data } = event;
    const userId = this.getUserId(data);
    const priceId = this.getPriceId(data);
    if (!userId || !priceId) {
      logOperationalEvent.warn(
        'Waffo one-time event is missing userId or priceId'
      );
      return;
    }
    const now = new Date();
    try {
      await getDb()
        .insert(payment)
        .values({
          id: data.orderId,
          priceId,
          userId,
          customerId: data.merchantProvidedBuyerIdentity ?? userId,
          subscriptionId: null,
          sessionId: this.getPaymentSessionId(data),
          invoiceId: data.paymentId ?? event.eventId,
          type: PaymentTypes.ONE_TIME,
          scene: PaymentScenes.LIFETIME,
          interval: null,
          status: 'completed',
          paid: true,
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: null,
          trialStart: null,
          trialEnd: null,
          createdAt: now,
          updatedAt: now,
        });
      await sendPaymentNotification({
        sessionId: data.orderId,
        customerId: data.merchantProvidedBuyerIdentity ?? userId,
        userName: data.orderMetadata?.userName ?? data.buyerEmail,
        amount: Number(data.amount),
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        logOperationalEvent.log(
          'Waffo one-time payment already exists, skipping'
        );
        return;
      }
      throw error;
    }
  }

  private async createSubscriptionPayment(event: WaffoEvent): Promise<void> {
    const { data } = event;
    const userId = this.getUserId(data);
    const priceId = this.getPriceId(data);
    if (!userId || !priceId) {
      logOperationalEvent.warn(
        'Waffo subscription event is missing userId or priceId'
      );
      return;
    }
    const periodStart = this.parseDate(data.currentPeriodStart);
    const periodEnd = this.parseDate(data.currentPeriodEnd);
    const now = new Date();
    try {
      await getDb()
        .insert(payment)
        .values({
          id: data.orderId,
          priceId,
          userId,
          customerId: data.merchantProvidedBuyerIdentity ?? userId,
          subscriptionId: data.orderId,
          sessionId: this.getPaymentSessionId(data),
          invoiceId: data.paymentId ?? event.eventId,
          type: PaymentTypes.SUBSCRIPTION,
          scene: PaymentScenes.SUBSCRIPTION,
          interval: this.mapBillingPeriod(data.billingPeriod),
          status: this.mapSubscriptionStatus(data.orderStatus),
          paid: true,
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: data.orderStatus === 'canceling',
          trialStart: null,
          trialEnd: null,
          createdAt: now,
          updatedAt: now,
        });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        logOperationalEvent.log(
          'Waffo subscription payment already exists, skipping'
        );
        return;
      }
      throw error;
    }
  }

  private async updateSubscription(
    event: WaffoEvent,
    options: SubscriptionUpdate = {}
  ): Promise<void> {
    const { data } = event;
    const values: Partial<typeof payment.$inferInsert> = {
      paid: options.paid ?? true,
      updatedAt: new Date(),
    };
    if (data.orderStatus || options.status) {
      values.status = this.mapSubscriptionStatus(
        data.orderStatus,
        options.status
      );
    }
    const cancelAtPeriodEnd =
      options.cancelAtPeriodEnd ??
      (data.orderStatus ? data.orderStatus === 'canceling' : undefined);
    if (cancelAtPeriodEnd !== undefined) {
      values.cancelAtPeriodEnd = cancelAtPeriodEnd;
    }
    const periodStart = this.parseDate(data.currentPeriodStart);
    const periodEnd = this.parseDate(data.currentPeriodEnd);
    if (periodStart) values.periodStart = periodStart;
    if (periodEnd) values.periodEnd = periodEnd;
    if (data.billingPeriod) {
      values.interval = this.mapBillingPeriod(data.billingPeriod);
    }
    if (options.syncPlan) {
      const priceId = this.getPriceId(data, true);
      if (priceId) values.priceId = priceId;
    }
    const result = await getDb()
      .update(payment)
      .set(values)
      .where(eq(payment.subscriptionId, data.orderId))
      .returning({ id: payment.id });

    if (result.length === 0) {
      throw new Error(
        `No payment record found for ${event.eventType}: ${data.orderId}`
      );
    }
  }

  /**
   * Any successful refund (partial or full) revokes access, matching the
   * behavior of the Stripe and Creem providers. Waffo's webhook payload has
   * no reliable partial-vs-full marker (SDK exposes only refundStatus /
   * refundReason / refundCreatedAt, and the `amount` field's meaning inside
   * a refund event is not documented). If a partial refund should still
   * grant access, handle it manually in the merchant dashboard.
   */
  private async revokeRefundedPayment(event: WaffoEvent): Promise<void> {
    const { orderId, paymentId } = event.data;
    // Renewals never rewrite invoiceId, so also match the order the refunded
    // payment belongs to.
    const filters = [
      ...(paymentId ? [eq(payment.invoiceId, paymentId)] : []),
      ...(orderId ? [eq(payment.id, orderId)] : []),
    ];
    if (filters.length === 0) {
      logOperationalEvent.warn(
        'Waffo refund event is missing paymentId and orderId'
      );
      return;
    }
    await getDb()
      .update(payment)
      .set({ paid: false, updatedAt: new Date() })
      .where(or(...filters));
  }

  /** Application locale → Waffo hosted checkout language. */
  private mapLocaleToWaffoLanguage(
    locale?: string
  ): CashierLanguage | undefined {
    if (!locale) return undefined;
    return WAFFO_LANGUAGES[locale] ?? WAFFO_LANGUAGES[locale.split('-')[0]];
  }

  private parseDate(value?: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private mapBillingPeriod(value?: string): PlanInterval {
    return value === 'yearly' ? PlanIntervals.YEAR : PlanIntervals.MONTH;
  }

  private mapSubscriptionStatus(
    status: string | undefined,
    fallback: PaymentStatus = 'active'
  ): PaymentStatus {
    switch (status) {
      case 'past_due':
        return 'past_due';
      // Still active until the current period ends; the pending cancellation
      // is tracked separately through payment.cancelAtPeriodEnd.
      case 'canceling':
        return 'active';
      case 'canceled':
      case 'expired':
      case 'closed':
        return 'canceled';
      case 'active':
        return 'active';
      default:
        return fallback;
    }
  }

  /** D1 reports duplicate rows as `UNIQUE constraint failed: ...`. */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Error && error.message.toLowerCase().includes('unique')
    );
  }
}
