import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { user } from '@/db/auth.schema';
import { getLocale } from '@/lib/locale';
import { normalizePaymentReturnUrl } from '@/lib/payment-return-url';
import { findPlanByPriceId, getAllPricePlans } from '@/lib/price-plan';
import { Routes } from '@/lib/routes';
import { getCanonicalUrl } from '@/lib/urls';
import { authApiMiddleware } from '@/middlewares/auth-middleware';
import {
  createCheckout,
  createCustomerPortal,
  getPaymentProvider,
} from '@/payment';
import type {
  PaymentStatus,
  PlanInterval,
  PricePlan,
  Subscription,
} from '@/payment/types';
import { PaymentScenes, PaymentTypes } from '@/payment/types';
import { createServerFn } from '@tanstack/react-start';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';

const checkoutSchema = z.object({
  planId: z.string().min(1),
  priceId: z.string().min(1),
  successUrl: z.string().trim().min(1).optional(),
  cancelUrl: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  theme: z.enum(['dark', 'light']).optional(),
});

export const createCheckoutSession = createServerFn({ method: 'POST' })
  .validator(checkoutSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const db = getDb();
    const [userRow] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!userRow?.email) throw new Error('User email not found');
    const { planId, priceId, successUrl, cancelUrl, metadata, theme } = data;
    const normalizedSuccessUrl = normalizePaymentReturnUrl(successUrl);
    const normalizedCancelUrl = normalizePaymentReturnUrl(cancelUrl);
    const locale = getLocale();
    const provider = getPaymentProvider();
    const hostsPostCheckoutPage = provider.hostsPostCheckoutPage === true;
    const paymentReference = hostsPostCheckoutPage
      ? crypto.randomUUID()
      : undefined;
    const billingUrl = getCanonicalUrl(Routes.SettingsBilling);
    const cancel = normalizedCancelUrl ?? billingUrl;

    // For Stripe: {CHECKOUT_SESSION_ID} is replaced by Stripe on redirect,
    // then the Payment page polls by sessionId until the webhook writes the DB record.
    // For providers that host their own post-checkout page (Creem, Waffo):
    // neither replaces URL placeholders, so the server generates an
    // order-scoped reference that is carried through provider metadata and
    // the webhook-backed payment row.
    const success = hostsPostCheckoutPage
      ? (normalizedSuccessUrl ??
        getCanonicalUrl(
          `${Routes.Payment}?checkout_id=${paymentReference}&callback=${encodeURIComponent(Routes.SettingsBilling)}`
        ))
      : (normalizedSuccessUrl ??
        getCanonicalUrl(
          `${Routes.Payment}?session_id={CHECKOUT_SESSION_ID}&callback=${Routes.SettingsBilling}`
        ));
    const checkoutMetadata = {
      ...metadata,
      userId,
      userName: userRow.name ?? '',
      ...(paymentReference ? { paymentReference } : {}),
    };

    const result = await createCheckout({
      planId,
      priceId,
      customerEmail: userRow.email,
      successUrl: success,
      cancelUrl: cancel,
      metadata: checkoutMetadata,
      locale,
      theme,
    });
    return { url: result.url, id: result.id };
  });

const portalSchema = z.object({
  returnUrl: z.string().trim().min(1).optional(),
  locale: z.string().optional(),
});

export const createCustomerPortalSession = createServerFn({ method: 'POST' })
  .validator(portalSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const normalizedReturnUrl = normalizePaymentReturnUrl(data.returnUrl);
    const provider = getPaymentProvider();
    const db = getDb();
    const [row] = await db
      .select({ customerId: user.customerId })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (provider.requiresCustomerId !== false && !row?.customerId) {
      throw new Error('No customer found for user');
    }
    const locale = getLocale();
    const returnUrl =
      normalizedReturnUrl ?? getCanonicalUrl(Routes.SettingsBilling);
    const result = await createCustomerPortal({
      customerId: row?.customerId ?? '',
      returnUrl,
      locale: data.locale ?? locale,
    });
    return { url: result.url };
  });

export const getCurrentPlan = createServerFn({ method: 'GET' })
  .middleware([authApiMiddleware])
  .handler(async ({ context }) => {
    const { userId } = context;
    const db = getDb();
    const plans = getAllPricePlans();
    const freePlan = plans.find((p) => p.isFree && !p.disabled) ?? null;
    const lifetimePlanIds = plans.filter((p) => p.isLifetime).map((p) => p.id);

    const payments = await db
      .select({
        id: payment.id,
        priceId: payment.priceId,
        customerId: payment.customerId,
        type: payment.type,
        status: payment.status,
        scene: payment.scene,
        interval: payment.interval,
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd,
        cancelAtPeriodEnd: payment.cancelAtPeriodEnd,
        trialStart: payment.trialStart,
        trialEnd: payment.trialEnd,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .where(
        and(
          eq(payment.paid, true),
          eq(payment.userId, userId),
          or(
            and(
              eq(payment.type, PaymentTypes.ONE_TIME),
              eq(payment.scene, PaymentScenes.LIFETIME),
              eq(payment.status, 'completed')
            ),
            and(
              eq(payment.type, PaymentTypes.SUBSCRIPTION),
              or(eq(payment.status, 'active'), eq(payment.status, 'trialing'))
            )
          )
        )
      )
      .orderBy(desc(payment.createdAt));

    let userLifetimePlan: PricePlan | null = null;
    let activeSubscription: Subscription | null = null;

    for (const rec of payments) {
      if (
        rec.type === PaymentTypes.ONE_TIME &&
        rec.scene === PaymentScenes.LIFETIME &&
        rec.status === 'completed' &&
        !userLifetimePlan
      ) {
        const plan = findPlanByPriceId(rec.priceId);
        if (plan && lifetimePlanIds.includes(plan.id)) {
          userLifetimePlan = plan as PricePlan;
        }
      }
      if (
        !userLifetimePlan &&
        rec.type === PaymentTypes.SUBSCRIPTION &&
        (rec.status === 'active' || rec.status === 'trialing') &&
        !activeSubscription
      ) {
        activeSubscription = {
          id: rec.id,
          priceId: rec.priceId,
          customerId: rec.customerId,
          status: rec.status as PaymentStatus,
          type: rec.type as 'subscription',
          interval: rec.interval as PlanInterval | undefined,
          currentPeriodStart: rec.periodStart ?? undefined,
          currentPeriodEnd: rec.periodEnd ?? undefined,
          cancelAtPeriodEnd: rec.cancelAtPeriodEnd ?? false,
          trialStartDate: rec.trialStart ?? undefined,
          trialEndDate: rec.trialEnd ?? undefined,
          createdAt: rec.createdAt,
        };
      }
    }

    if (userLifetimePlan) {
      return { currentPlan: userLifetimePlan, subscription: null };
    }
    if (activeSubscription) {
      const subscriptionPlan =
        plans.find((p) =>
          p.prices.some((pr) => pr.priceId === activeSubscription!.priceId)
        ) ?? null;
      return {
        currentPlan: subscriptionPlan as PricePlan | null,
        subscription: activeSubscription,
      };
    }
    return { currentPlan: freePlan as PricePlan | null, subscription: null };
  });

const checkCompletionSchema = z.object({ sessionId: z.string().min(1) });

/**
 * Check payment completion by an order-scoped checkout reference.
 * Stripe supplies its Checkout Session ID; hosted providers round-trip the
 * server-generated payment reference through webhook metadata.
 */
export const checkPaymentCompletion = createServerFn({ method: 'GET' })
  .validator(checkCompletionSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [record] = await db
      .select({ id: payment.id })
      .from(payment)
      .where(
        and(
          eq(payment.sessionId, data.sessionId),
          eq(payment.userId, context.userId),
          eq(payment.paid, true)
        )
      )
      .limit(1);
    return { isPaid: !!record };
  });
