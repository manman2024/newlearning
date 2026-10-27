import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { user } from '@/db/auth.schema';
import type { Payment } from '@/db/types';
import { findPlanByPlanId, findPriceInPlan } from '@/lib/price-plan';
import { sendPaymentNotification } from '@/notification';
import { InvalidWebhookSignatureError } from '@/payment/errors';
import { and, desc, eq } from 'drizzle-orm';
import { Stripe } from 'stripe';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PaymentStatus,
  PlanInterval,
  PortalResult,
} from '../types';
import { PlanIntervals, PaymentScenes, PaymentTypes } from '../types';
import { logOperationalEvent } from '@/lib/observability';

/**
 * Stripe payment provider implementation
 */
export class StripeProvider implements PaymentProvider {
  private stripe: Stripe;
  private webhookSecret: string;

  /**
   * Initialize Stripe provider with API key
   */
  constructor() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set.');
    }

    // Initialize Stripe without specifying apiVersion to use default/latest version
    this.stripe = new Stripe(apiKey);
    this.webhookSecret = webhookSecret;
  }

  getProviderName(): string {
    return 'stripe';
  }

  /**
   * Create a customer in Stripe if not exists
   * @param email Customer email
   * @param name Optional customer name
   * @returns Stripe customer ID
   */
  private async createOrGetCustomer(
    email: string,
    name?: string
  ): Promise<string> {
    try {
      // Search for existing customer
      const customers = await this.stripe.customers.list({
        email,
        limit: 1,
      });

      // Find existing customer
      if (customers.data && customers.data.length > 0) {
        const customerId = customers.data[0].id;

        // Find user id by customer id
        const userId = await this.findUserIdByCustomerId(customerId);
        // If no userId found, it means the user record exists (by email) but lacks customerId
        // This can happen when user was created before Stripe integration or data got out of sync
        // Fix the data inconsistency by updating the user's customerId field
        if (!userId) {
          logOperationalEvent.log(
            'User exists but missing customerId, fixing data inconsistency'
          );
          await this.updateUserWithCustomerId(customerId, email);
        }
        return customerId;
      }

      // Create new customer
      const customer = await this.stripe.customers.create({
        email,
        name: name || undefined,
      });

      // Update user record in database with the new customer ID
      await this.updateUserWithCustomerId(customer.id, email);

      return customer.id;
    } catch (error) {
      logOperationalEvent.error('Create or get customer error:', error);
      throw new Error('Failed to create or get customer');
    }
  }

  /**
   * Updates a user record with a Stripe customer ID
   * @param customerId Stripe customer ID
   * @param email Customer email
   * @returns Promise that resolves when the update is complete
   */
  private async updateUserWithCustomerId(
    customerId: string,
    email: string
  ): Promise<void> {
    try {
      // Update user record with customer ID if email matches
      const db = getDb();
      const result = await db
        .update(user)
        .set({
          customerId: customerId,
          updatedAt: new Date(),
        })
        .where(eq(user.email, email))
        .returning({ id: user.id });

      if (result.length > 0) {
        logOperationalEvent.log('Updated user with customer ID (hidden)');
      } else {
        logOperationalEvent.log('No user found with given email');
      }
    } catch (error) {
      logOperationalEvent.error('Update user with customer ID error:', error);
      throw new Error('Failed to update user with customer ID');
    }
  }

  /**
   * Finds a user by customerId
   * @param customerId Stripe customer ID
   * @returns User ID or undefined if not found
   */
  private async findUserIdByCustomerId(
    customerId: string
  ): Promise<string | undefined> {
    try {
      // Query the user table for a matching customerId
      const db = getDb();
      const result = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.customerId, customerId))
        .limit(1);

      if (result.length > 0) {
        return result[0].id;
      }
      logOperationalEvent.warn('No user found with given customerId');

      return undefined;
    } catch (error) {
      logOperationalEvent.error('Find user by customer ID error:', error);
      return undefined;
    }
  }
  /**
   * Validates that a checkout session has required metadata
   * @param session Stripe checkout session
   * @returns Object with userId and customerId
   * @throws Error if required fields are missing
   */
  private validateSessionMetadata(session: Stripe.Checkout.Session): {
    userId: string;
    customerId: string;
  } {
    const userId = session.metadata?.userId;
    if (!userId || userId.trim() === '') {
      throw new Error(
        `Checkout session ${session.id} missing or empty userId in metadata - cannot process`
      );
    }

    const customerId = session.customer;
    if (!customerId || typeof customerId !== 'string') {
      throw new Error(
        `Checkout session ${session.id} missing or invalid customerId - cannot process`
      );
    }

    return { userId, customerId };
  }

  /**
   * Create a checkout session for a plan
   * @param params Parameters for creating the checkout session
   * @returns Checkout result
   */
  public async createCheckout(
    params: CreateCheckoutParams
  ): Promise<CheckoutResult> {
    const {
      planId,
      priceId,
      customerEmail,
      successUrl,
      cancelUrl,
      metadata,
      locale,
    } = params;

    try {
      // Get plan and price
      const plan = findPlanByPlanId(planId);
      if (!plan) {
        throw new Error(`Plan with ID ${planId} not found`);
      }

      // Find price in plan
      const price = findPriceInPlan(planId, priceId);
      if (!price) {
        throw new Error(`Price ID ${priceId} not found in plan ${planId}`);
      }

      // Get userName from metadata if available
      const userName = metadata?.userName;

      // Create or get customer
      const customerId = await this.createOrGetCustomer(
        customerEmail,
        userName
      );

      // Add planId and priceId to metadata, so we can get it in the webhook event
      const customMetadata = {
        ...metadata,
        planId,
        priceId,
      };

      // Set up the line items
      const lineItems = [
        {
          price: priceId,
          quantity: 1,
        },
      ];

      // Create checkout session parameters
      const checkoutParams: Stripe.Checkout.SessionCreateParams = {
        line_items: lineItems,
        mode:
          price.type === PaymentTypes.SUBSCRIPTION ? 'subscription' : 'payment',
        success_url: successUrl ?? '',
        cancel_url: cancelUrl ?? '',
        metadata: customMetadata,
        allow_promotion_codes: price.allowPromotionCode ?? false,
      };

      // Add customer to checkout session
      checkoutParams.customer = customerId;

      if (locale) {
        checkoutParams.locale = this.mapLocaleToStripeLocale(locale);
      }

      // Add payment intent data for one-time payments
      if (price.type === PaymentTypes.ONE_TIME) {
        checkoutParams.payment_intent_data = {
          metadata: customMetadata,
        };
        // Automatically create an invoice for the one-time payment
        checkoutParams.invoice_creation = {
          enabled: true,
          invoice_data: {
            metadata: customMetadata,
          },
        };
      }

      // Add subscription data for recurring payments
      if (price.type === PaymentTypes.SUBSCRIPTION) {
        // Initialize subscription_data with metadata
        checkoutParams.subscription_data = {
          metadata: customMetadata,
        };

        // Add trial period if applicable
        if (price.trialPeriodDays && price.trialPeriodDays > 0) {
          checkoutParams.subscription_data.trial_period_days =
            price.trialPeriodDays;
        }
      }

      // Create the checkout session
      const session =
        await this.stripe.checkout.sessions.create(checkoutParams);

      return {
        url: session.url!,
        id: session.id,
      };
    } catch (error) {
      logOperationalEvent.error('Create checkout session error:', error);
      throw new Error('Failed to create checkout session');
    }
  }

  /**
   * Create a customer portal session
   * @param params Parameters for creating the portal
   * @returns Portal result
   */
  public async createCustomerPortal(
    params: CreatePortalParams
  ): Promise<PortalResult> {
    const { customerId, returnUrl, locale } = params;

    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl ?? '',
        locale: locale ? this.mapLocaleToStripeLocale(locale) : undefined,
      });

      return {
        url: session.url,
      };
    } catch (error) {
      logOperationalEvent.error('Create customer portal error:', error);
      throw new Error('Failed to create customer portal');
    }
  }

  /**
   * Handle webhook event
   * @param payload Raw webhook payload
   * @param signature Webhook signature
   */
  public async handleWebhookEvent(
    payload: string,
    signature: string
  ): Promise<void> {
    try {
      // Verify the event signature if webhook secret is available
      const event = await this.stripe.webhooks.constructEventAsync(
        payload,
        signature,
        this.webhookSecret
      );
      const eventType = event.type;
      logOperationalEvent.log(`handle webhook event, type: ${eventType}`);

      // Handle subscription events
      if (eventType.startsWith('customer.subscription.')) {
        const stripeSubscription = event.data.object as Stripe.Subscription;

        // Process based on subscription status and event type
        switch (eventType) {
          case 'customer.subscription.created': {
            await this.onCreateSubscription(stripeSubscription);
            break;
          }
          case 'customer.subscription.updated': {
            await this.onUpdateSubscription(stripeSubscription);
            break;
          }
          case 'customer.subscription.deleted': {
            await this.onDeleteSubscription(stripeSubscription);
            break;
          }
        }
      } else if (eventType.startsWith('invoice.')) {
        // Handle invoice events
        switch (eventType) {
          case 'invoice.paid': {
            const invoice = event.data.object as Stripe.Invoice;
            await this.onInvoicePaid(invoice);
            break;
          }
        }
      } else if (eventType.startsWith('checkout.')) {
        // Handle checkout events
        if (eventType === 'checkout.session.completed') {
          const session = event.data.object as Stripe.Checkout.Session;
          await this.onCheckoutCompleted(session);
        }
      } else if (eventType === 'charge.refunded') {
        const charge = event.data.object as Stripe.Charge;
        await this.onChargeRefunded(charge);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown';
      logOperationalEvent.error('handle webhook event error:', errorMessage);
      if (
        error instanceof Stripe.errors.StripeSignatureVerificationError ||
        (typeof error === 'object' &&
          error !== null &&
          'type' in error &&
          error.type === 'StripeSignatureVerificationError')
      ) {
        throw new InvalidWebhookSignatureError();
      }
      throw new Error('Failed to handle webhook event');
    }
  }

  private async findPaymentRecord(
    invoice: Stripe.Invoice
  ): Promise<Payment | null> {
    const db = getDb();

    // Strategy 1: Find by invoice ID (most reliable)
    if (invoice.id) {
      const paymentsByInvoice = await db
        .select()
        .from(payment)
        .where(eq(payment.invoiceId, invoice.id))
        .orderBy(desc(payment.createdAt))
        .limit(1);

      if (paymentsByInvoice.length > 0) {
        logOperationalEvent.log('Found payment record by invoice ID');
        return paymentsByInvoice[0];
      }
    }

    // Strategy 2: For subscription payments, find by subscription ID
    const subscriptionId = this.extractSubscriptionId(invoice);
    if (subscriptionId) {
      const paymentsBySubscription = await db
        .select()
        .from(payment)
        .where(eq(payment.subscriptionId, subscriptionId))
        .orderBy(desc(payment.createdAt))
        .limit(1);

      if (paymentsBySubscription.length > 0) {
        logOperationalEvent.log('Found payment record by subscription ID');
        return paymentsBySubscription[0];
      }
    }

    logOperationalEvent.warn(
      'No payment record found for invoice:',
      invoice.id
    );
    return null;
  }

  /**
   * Apply Stripe's authoritative paid transition. Existing rows are updated;
   * an Invoice delivered before Checkout reconstructs its Session and row.
   *
   * @param invoice Stripe invoice
   */
  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    logOperationalEvent.log('>> Handle invoice paid, invoiceId:', invoice.id);

    try {
      const paymentRecord = await this.findPaymentRecord(invoice);
      if (!paymentRecord) {
        await this.reconstructPaidPayment(invoice);
        logOperationalEvent.log(
          '<< Handle invoice paid success after reconstruction'
        );
        return;
      }

      // Determine payment type based on existing payment record type
      // This is more reliable than checking invoice.subscription field
      const isSubscriptionPayment =
        paymentRecord.type === PaymentTypes.SUBSCRIPTION;

      if (isSubscriptionPayment) {
        // This is a subscription payment
        await this.updateSubscriptionPayment(invoice, paymentRecord);
      } else {
        // This is a one-time payment
        await this.updateOneTimePayment(invoice, paymentRecord);
      }
    } catch (error) {
      logOperationalEvent.error('<< Handle invoice paid error:', error);

      // Check if it's a duplicate invoice error (database constraint violation)
      if (this.isUniqueConstraintError(error)) {
        logOperationalEvent.log('<< Invoice already processed:', invoice.id);
        return; // Don't throw, this is expected for duplicate processing
      }

      // For other errors, let Stripe retry
      throw error;
    }

    logOperationalEvent.log('<< Handle invoice paid success');
  }

  /**
   * Reconstruct the local payment context when Stripe delivers invoice.paid
   * before checkout.session.completed. The recovered Checkout Session supplies
   * the session ID polled by the payment result page and the original metadata.
   */
  private async reconstructPaidPayment(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = this.extractSubscriptionId(invoice);

    if (subscriptionId) {
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const sessions = await this.stripe.checkout.sessions.list({
        subscription: subscriptionId,
        limit: 10,
      });
      const session = sessions.data[0];
      if (!session) {
        throw new Error(
          `No Checkout Session found for subscription ${subscriptionId}`
        );
      }

      const priceId = subscription.items.data[0]?.price.id;
      if (!priceId) {
        throw new Error(`Subscription ${subscriptionId} has no price`);
      }
      const { userId, customerId } = this.validateSessionMetadata(session);
      const inserted = await this.insertPaymentRecord(
        {
          priceId,
          type: PaymentTypes.SUBSCRIPTION,
          scene: PaymentScenes.SUBSCRIPTION,
          userId,
          customerId,
          subscriptionId,
          sessionId: session.id,
          invoiceId: invoice.id,
          paid: true,
          interval: this.mapStripeIntervalToPlanInterval(subscription),
          status: this.mapSubscriptionStatusToPaymentStatus(
            subscription.status
          ),
          periodStart: this.getPeriodStart(subscription),
          periodEnd: this.getPeriodEnd(subscription),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          trialStart: subscription.trial_start
            ? new Date(subscription.trial_start * 1000)
            : null,
          trialEnd: subscription.trial_end
            ? new Date(subscription.trial_end * 1000)
            : null,
        },
        'subscription'
      );

      if (!inserted) {
        await this.updateRacedPayment(invoice, session.id);
        return;
      }
      await this.processSubscriptionPurchase(userId, priceId);
      return;
    }

    const session = await this.findOneTimeCheckoutSession(invoice);
    if (!session) {
      throw new Error(`No Checkout Session found for invoice ${invoice.id}`);
    }

    const priceId = session.metadata?.priceId;
    if (!priceId) {
      throw new Error(`Checkout session ${session.id} has no priceId metadata`);
    }
    const { userId, customerId } = this.validateSessionMetadata(session);

    // A one-time row has no subscriptionId fallback, so a row created by
    // checkout.session.completed with a not-yet-populated invoiceId is invisible
    // to findPaymentRecord. Match it by sessionId before inserting so we update
    // the existing row to paid instead of creating a duplicate.
    const existing = await this.findPaymentRecordBySessionId(session.id);
    if (existing) {
      await this.updateOneTimePayment(invoice, existing);
      return;
    }

    const inserted = await this.insertPaymentRecord(
      {
        priceId,
        type: PaymentTypes.ONE_TIME,
        scene: PaymentScenes.LIFETIME,
        userId,
        customerId,
        sessionId: session.id,
        invoiceId: invoice.id,
        paid: true,
        status: 'completed',
      },
      'one-time'
    );

    if (!inserted) {
      await this.updateRacedPayment(invoice, session.id);
      return;
    }
    await this.processLifetimePlanPurchase(
      invoice,
      {
        customerId,
        sessionId: session.id,
      },
      session
    );
  }

  /**
   * Locate the Checkout Session that produced a one-time invoice.
   *
   * A paid order exposes a PaymentIntent that maps straight to its session. A
   * fully discounted ($0) order has no PaymentIntent (Stripe omits it for
   * no-cost orders), so fall back to matching the customer's session against
   * the invoice it generated. Without this, invoice.paid delivered before
   * checkout.session.completed could never reconstruct a $0 Lifetime row.
   */
  private async findOneTimeCheckoutSession(
    invoice: Stripe.Invoice
  ): Promise<Stripe.Checkout.Session | null> {
    const paymentIntentId =
      this.extractPaymentIntentId(invoice) ??
      this.extractPaymentIntentId(
        await this.stripe.invoices.retrieve(invoice.id)
      );

    if (paymentIntentId) {
      const byPaymentIntent = await this.stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit: 10,
      });
      if (byPaymentIntent.data[0]) {
        return byPaymentIntent.data[0];
      }
    }

    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : (invoice.customer?.id ?? null);
    if (!customerId) {
      return null;
    }

    const byCustomer = await this.stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    });
    return (
      byCustomer.data.find((candidate) => candidate.invoice === invoice.id) ??
      null
    );
  }

  private extractPaymentIntentId(invoice: Stripe.Invoice): string | null {
    const paymentIntent = invoice.payment_intent;
    if (typeof paymentIntent === 'string') return paymentIntent;
    if (paymentIntent && typeof paymentIntent === 'object') {
      return paymentIntent.id;
    }
    return null;
  }

  private async updateRacedPayment(
    invoice: Stripe.Invoice,
    sessionId: string
  ): Promise<void> {
    const paymentRecord =
      (await this.findPaymentRecord(invoice)) ??
      (await this.findPaymentRecordBySessionId(sessionId));
    if (!paymentRecord) {
      throw new Error(
        `Payment conflict for invoice ${invoice.id} could not be recovered`
      );
    }

    if (paymentRecord.type === PaymentTypes.SUBSCRIPTION) {
      await this.updateSubscriptionPayment(invoice, paymentRecord);
    } else {
      await this.updateOneTimePayment(invoice, paymentRecord);
    }
  }

  private async findPaymentRecordBySessionId(
    sessionId: string
  ): Promise<Payment | null> {
    const db = getDb();
    const records = await db
      .select()
      .from(payment)
      .where(eq(payment.sessionId, sessionId))
      .orderBy(desc(payment.createdAt))
      .limit(1);
    return records[0] ?? null;
  }

  /**
   * Update subscription payment record and process benefits
   *
   * The order of events may be:
   * checkout.session.completed
   * customer.subscription.created
   * customer.subscription.updated
   * invoice.paid
   *
   * @param invoice Stripe invoice
   * @param paymentRecord Payment record
   */
  private async updateSubscriptionPayment(
    invoice: Stripe.Invoice,
    paymentRecord: Payment
  ): Promise<void> {
    logOperationalEvent.log('>> Update subscription payment record');

    try {
      let subscriptionId = invoice.subscription as string | null;

      // If invoice.subscription is null, try to use paymentRecord.subscriptionId
      if (!subscriptionId && paymentRecord.subscriptionId) {
        subscriptionId = paymentRecord.subscriptionId;
        logOperationalEvent.log(
          'subscriptionId from paymentRecord:',
          subscriptionId
        );
      }

      if (!subscriptionId) {
        logOperationalEvent.warn(
          '<< No subscriptionId found in invoice or paymentRecord'
        );
        return;
      }

      // Get subscription details from Stripe
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const customerId = subscription.customer as string;

      // Get priceId from subscription items
      const priceId = subscription.items.data[0]?.price.id;
      if (!priceId) {
        logOperationalEvent.warn('<< No priceId found for subscription');
        return;
      }

      // Get userId from subscription metadata or fallback to customerId lookup
      let userId: string | undefined = subscription.metadata?.userId;

      // If no userId in metadata (common in renewals), find by customerId
      if (!userId) {
        logOperationalEvent.log('No userId in metadata, finding by customerId');
        userId = await this.findUserIdByCustomerId(customerId);

        if (!userId) {
          logOperationalEvent.error(
            '<< No userId found, this should not happen'
          );
          return;
        }
      }

      const periodStart = this.getPeriodStart(subscription);
      const periodEnd = this.getPeriodEnd(subscription);
      const trialStart = subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : null;
      const trialEnd = subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null;
      const currentDate = new Date();

      // Update payment record with all subscription details
      const db = getDb();
      await db
        .update(payment)
        .set({
          // invoiceId: invoice.id, // do not update invoiceId
          paid: true, // Mark as paid
          interval: this.mapStripeIntervalToPlanInterval(subscription),
          status: this.mapSubscriptionStatusToPaymentStatus(
            subscription.status
          ),
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          trialStart,
          trialEnd,
          updatedAt: currentDate,
        })
        .where(eq(payment.id, paymentRecord.id));

      // Apply any subscription-specific benefits.
      await this.processSubscriptionPurchase(userId, priceId);
    } catch (error) {
      logOperationalEvent.error('<< Update subscription payment error:', error);
      throw error;
    }

    logOperationalEvent.log('<< Update subscription payment record success');
  }

  /**
   * Process subscription purchase
   * @param _userId User ID (reserved for future use, e.g. credits)
   * @param _priceId Price ID (reserved for future use, e.g. credits)
   */
  private async processSubscriptionPurchase(
    _userId: string,
    _priceId: string
  ): Promise<void> {
    logOperationalEvent.log('>> Process subscription purchase');

    // No additional subscription benefits are configured.
    logOperationalEvent.log('<< Process subscription purchase success');
  }

  /**
   * Update one-time payment record and process benefits
   *
   * The order of events may be:
   * checkout.session.completed
   * invoice.paid
   *
   * @param invoice Stripe invoice
   * @param paymentRecord Payment record
   */
  private async updateOneTimePayment(
    invoice: Stripe.Invoice,
    paymentRecord: Payment
  ): Promise<void> {
    logOperationalEvent.log('>> Update one-time payment record');

    try {
      // Update payment record with invoice details
      const db = getDb();
      const paidTransition = await db
        .update(payment)
        .set({
          // invoiceId: invoice.id, // do not update invoiceId
          status: 'completed', // One-time payments are completed when invoice is paid
          paid: true, // Mark as paid
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payment.id, paymentRecord.id),
            eq(payment.paid, false),
            eq(payment.status, 'completed')
          )
        )
        .returning({ id: payment.id });

      // Apply lifetime-plan benefits only on the first paid transition.
      if (
        !paymentRecord.paid &&
        paidTransition.length > 0 &&
        paymentRecord.sessionId
      ) {
        const session = await this.stripe.checkout.sessions.retrieve(
          paymentRecord.sessionId
        );
        await this.processLifetimePlanPurchase(invoice, paymentRecord, session);
      }
    } catch (error) {
      logOperationalEvent.error('<< Update one-time payment error:', error);
      throw error;
    }

    logOperationalEvent.log('<< Update one-time payment record success');
  }

  /**
   * Revoke the matching lifetime payment after a full Stripe refund.
   *
   * Partial refunds keep the existing access because the product policy is
   * to revoke Lifetime only when the whole charge has been refunded.
   */
  private async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const customerId =
      typeof charge.customer === 'string'
        ? charge.customer
        : charge.customer?.id;

    if (!customerId || !charge.refunded) {
      logOperationalEvent.warn('<< Ignoring partial or unlinked Stripe refund');
      return;
    }

    const invoiceId =
      typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    let sessionId: string | undefined;
    if (!invoiceId && paymentIntentId) {
      const sessions = await this.stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit: 1,
      });
      sessionId = sessions.data[0]?.id;
    }
    if (!invoiceId && !sessionId) {
      logOperationalEvent.warn(
        '<< Refund has no matching invoice or checkout session'
      );
      return;
    }

    const db = getDb();
    const result = await db
      .update(payment)
      .set({
        paid: false,
        status: 'canceled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payment.customerId, customerId),
          eq(payment.type, PaymentTypes.ONE_TIME),
          eq(payment.scene, PaymentScenes.LIFETIME),
          invoiceId
            ? eq(payment.invoiceId, invoiceId)
            : eq(payment.sessionId, sessionId!),
          eq(payment.paid, true)
        )
      )
      .returning({ id: payment.id });

    if (result.length > 0) {
      logOperationalEvent.log(
        '<< Revoked matching lifetime access after Stripe refund'
      );
    } else {
      logOperationalEvent.warn(
        '<< No lifetime payment found for Stripe refund'
      );
    }
  }

  /**
   * Process lifetime plan purchase
   * @param invoice Stripe invoice
   * @param paymentRecord Payment record
   * @param session Checkout session (for userName in notification)
   */
  private async processLifetimePlanPurchase(
    invoice: Stripe.Invoice,
    paymentRecord: Pick<Payment, 'customerId' | 'sessionId'>,
    session: Stripe.Checkout.Session
  ): Promise<void> {
    logOperationalEvent.log('>> Process lifetime plan purchase');

    // Send notification
    const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
    await sendPaymentNotification({
      sessionId: paymentRecord.sessionId!,
      customerId: paymentRecord.customerId,
      userName: (session.metadata?.userName as string) ?? 'Customer',
      amount,
    });

    logOperationalEvent.log('<< Process lifetime plan purchase success');
  }

  /**
   * Handle subscription creation
   * Only log the event, payment records created in checkout.session.completed
   * @param stripeSubscription Stripe subscription
   */
  private async onCreateSubscription(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    logOperationalEvent.log(
      'Handle subscription creation:',
      stripeSubscription.id
    );
  }

  /**
   * Update payment record when subscription is updated
   *
   * When subscription is renewed, the order of events may be:
   * customer.subscription.updated
   * invoice.paid
   *
   * When subscription is cancelled, the order of events may be:
   * customer.subscription.updated
   *
   * In this case, we need to update the payment record.
   *
   * @param stripeSubscription Stripe subscription
   */
  private async onUpdateSubscription(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    logOperationalEvent.log(
      '>> Handle subscription update:',
      stripeSubscription.id
    );

    // get priceId from subscription items (this is always available)
    const priceId = stripeSubscription.items.data[0]?.price.id;
    if (!priceId) {
      logOperationalEvent.warn('<< No priceId found for subscription');
      return;
    }

    // get new period start and end
    const newPeriodStart = this.getPeriodStart(stripeSubscription);
    const newPeriodEnd = this.getPeriodEnd(stripeSubscription);
    const trialStart = stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : undefined;
    const trialEnd = stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : undefined;

    // update fields
    const updateFields: Record<string, unknown> = {
      priceId: priceId,
      interval: this.mapStripeIntervalToPlanInterval(stripeSubscription),
      status: this.mapSubscriptionStatusToPaymentStatus(
        stripeSubscription.status
      ),
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialStart: trialStart,
      trialEnd: trialEnd,
      updatedAt: new Date(),
    };

    const db = getDb();
    const result = await db
      .update(payment)
      .set(updateFields)
      .where(eq(payment.subscriptionId, stripeSubscription.id))
      .returning({ id: payment.id });

    if (result.length > 0) {
      logOperationalEvent.log('<< Updated payment record for subscription');
    } else {
      logOperationalEvent.warn(
        '<< No payment record found for subscription update'
      );
    }
  }

  /**
   * Update payment record when subscription is deleted
   *
   * When subscription is deleted, the order of events may be:
   * customer.subscription.deleted
   *
   * In this case, we need to update the payment record.
   *
   * @param stripeSubscription Stripe subscription
   */
  private async onDeleteSubscription(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    logOperationalEvent.log(
      '>> Handle subscription deletion:',
      stripeSubscription.id
    );

    const db = getDb();
    const result = await db
      .update(payment)
      .set({
        status: this.mapSubscriptionStatusToPaymentStatus(
          stripeSubscription.status
        ),
        updatedAt: new Date(),
      })
      .where(eq(payment.subscriptionId, stripeSubscription.id))
      .returning({ id: payment.id });

    if (result.length > 0) {
      logOperationalEvent.log(
        '<< Marked payment record for subscription as canceled'
      );
    } else {
      logOperationalEvent.warn(
        '<< No payment record found for subscription deletion'
      );
    }
  }

  /**
   * Handle checkout session completion
   * Create payment records with paid=false
   * @param session Stripe checkout session
   */
  private async onCheckoutCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    logOperationalEvent.log(
      '>> Handle checkout session completion:',
      session.id
    );

    try {
      if (session.mode === 'subscription') {
        await this.createSubscriptionPaymentRecord(session);
      } else if (session.mode === 'payment') {
        await this.createOneTimePaymentRecord(session);
      } else {
        logOperationalEvent.warn(
          '<< Unsupported checkout session mode:',
          session.mode
        );
        return;
      }
    } catch (error) {
      logOperationalEvent.error(
        '<< Handle checkout session completion error:',
        error
      );
      throw error;
    }

    logOperationalEvent.log('<< Handle checkout session completion success');
  }

  /**
   * Create subscription payment record in checkout.session.completed event
   * @param session Stripe checkout session
   */
  private async createSubscriptionPaymentRecord(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    logOperationalEvent.log('>> Create subscription payment record');

    if (!session.subscription) {
      logOperationalEvent.warn('<< No subscription found in session');
      return;
    }

    const subscriptionId = session.subscription as string;
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    // Get priceId from subscription items
    const priceId = subscription.items.data[0]?.price.id;
    if (!priceId) {
      logOperationalEvent.warn('<< No priceId found for subscription');
      return;
    }

    // Validate session metadata and get userId, customerId
    const { userId, customerId } = this.validateSessionMetadata(session);

    // No matter user uses coupon code or not, even amount=0, invoice id is available
    const invoiceId: string | null = session.invoice as string | null;
    logOperationalEvent.log(
      'createSubscriptionPaymentRecord, invoiceId:',
      invoiceId
    );

    const periodStart = this.getPeriodStart(subscription);
    const periodEnd = this.getPeriodEnd(subscription);
    const trialStart = subscription.trial_start
      ? new Date(subscription.trial_start * 1000)
      : null;
    const trialEnd = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null;

    // Checkout completion establishes the local payment context. Stripe's
    // invoice.paid event remains the authority for paid=true.
    await this.insertPaymentRecord(
      {
        priceId,
        type: PaymentTypes.SUBSCRIPTION,
        scene: PaymentScenes.SUBSCRIPTION,
        userId,
        customerId,
        subscriptionId,
        sessionId: session.id,
        invoiceId, // may be null initially
        paid: false,
        interval: this.mapStripeIntervalToPlanInterval(subscription),
        status: this.mapSubscriptionStatusToPaymentStatus(subscription.status),
        periodStart,
        periodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialStart,
        trialEnd,
      },
      'subscription'
    );
  }

  /**
   * Create one-time payment record in checkout.session.completed event
   * @param session Stripe checkout session
   */
  private async createOneTimePaymentRecord(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    logOperationalEvent.log('>> Create one-time payment record');

    const priceId = session.metadata?.priceId;
    if (!priceId) {
      logOperationalEvent.warn('<< No priceId found in session metadata');
      return;
    }

    // Validate session metadata and get userId, customerId
    const { userId, customerId } = this.validateSessionMetadata(session);

    // No matter user uses coupon code or not, even amount=0, invoice id is available
    const invoiceId: string | null = session.invoice as string | null;
    logOperationalEvent.log(
      'createOneTimePaymentRecord, invoiceId:',
      invoiceId
    );

    // One-time checkout purchases map to the lifetime scene.
    const scene = PaymentScenes.LIFETIME;

    // Checkout completion establishes the local payment context. Stripe's
    // invoice.paid event remains the authority for paid=true.
    await this.insertPaymentRecord(
      {
        priceId,
        type: PaymentTypes.ONE_TIME,
        scene,
        userId,
        customerId,
        sessionId: session.id,
        invoiceId, // may be null initially
        paid: false,
        status: 'completed', // one-time payments are completed once checkout is done
      },
      'one-time'
    );
  }

  /**
   * Unified helper for payment record insertion with error handling
   * Eliminates duplicate try-catch logic between subscription and one-time payments
   * Handles duplicate key constraint violations gracefully
   * @param paymentData Payment record data (excluding id, createdAt, updatedAt)
   * @param recordType Type for logging ("subscription" or "one-time")
   */
  private async insertPaymentRecord(
    paymentData: Omit<
      typeof payment.$inferInsert,
      'id' | 'createdAt' | 'updatedAt'
    >,
    recordType: string
  ): Promise<boolean> {
    const currentDate = new Date();
    const db = getDb();

    try {
      await db.insert(payment).values({
        id: crypto.randomUUID(),
        createdAt: currentDate,
        updatedAt: currentDate,
        ...paymentData,
      });

      logOperationalEvent.log(
        `<< Created ${recordType} payment record success`
      );
      return true;
    } catch (error) {
      // Handle duplicate key constraint violation gracefully
      if (this.isUniqueConstraintError(error)) {
        logOperationalEvent.log(
          `<< ${recordType} payment record already exists, skipping creation`
        );
        return false; // The caller may need to make paid=true win the race.
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    let current: unknown = error;
    const visited = new Set<unknown>();

    while (current && !visited.has(current)) {
      visited.add(current);
      if (
        current instanceof Error &&
        current.message.toLowerCase().includes('unique constraint')
      ) {
        return true;
      }
      current =
        typeof current === 'object' && current !== null && 'cause' in current
          ? current.cause
          : null;
    }

    return false;
  }

  /**
   * Map Stripe subscription interval to our own interval types
   * @param subscription Stripe subscription
   * @returns PlanInterval
   */
  private mapStripeIntervalToPlanInterval(
    subscription: Stripe.Subscription
  ): PlanInterval {
    switch (subscription.items.data[0]?.plan.interval) {
      case 'month':
        return PlanIntervals.MONTH;
      case 'year':
        return PlanIntervals.YEAR;
      default:
        return PlanIntervals.MONTH;
    }
  }

  /**
   * Convert Stripe subscription status to PaymentStatus,
   * we narrow down the status to our own status types
   * @param status Stripe subscription status
   * @returns PaymentStatus
   */
  private mapSubscriptionStatusToPaymentStatus(
    status: Stripe.Subscription.Status
  ): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      active: 'active',
      canceled: 'canceled',
      incomplete: 'incomplete',
      incomplete_expired: 'incomplete_expired',
      past_due: 'past_due',
      trialing: 'trialing',
      unpaid: 'unpaid',
      paused: 'paused',
    };

    return statusMap[status] || 'failed';
  }

  /**
   * Find existing payment record by Invoice
   * @param invoice Stripe invoice
   * @returns Payment record or null if not found
   */
  private extractSubscriptionId(invoice: Stripe.Invoice): string | null {
    const invoiceSubscription = invoice.subscription;
    if (typeof invoiceSubscription === 'string') {
      logOperationalEvent.log(
        `invoice.subscription is string: ${invoiceSubscription}`
      );
      return invoiceSubscription;
    }
    if (
      invoiceSubscription &&
      typeof invoiceSubscription === 'object' &&
      'id' in invoiceSubscription
    ) {
      logOperationalEvent.log(
        `invoice.subscription is object: ${invoiceSubscription.id}`
      );
      return invoiceSubscription.id;
    }

    const invoiceAny = invoice as {
      parent?: { subscription_details?: { subscription?: string } };
    };
    if (invoiceAny.parent?.subscription_details?.subscription) {
      const subscriptionId =
        invoiceAny.parent.subscription_details.subscription;
      logOperationalEvent.log(
        `invoice.parent.subscription_details.subscription is string: ${subscriptionId}`
      );
      return subscriptionId;
    }

    const lineItems = invoice.lines?.data ?? [];
    for (const lineItem of lineItems) {
      if (typeof lineItem.subscription === 'string') {
        logOperationalEvent.log(
          `invoice.lineItem.subscription is string: ${lineItem.subscription}`
        );
        return lineItem.subscription;
      }
      if (
        lineItem.subscription &&
        typeof lineItem.subscription === 'object' &&
        'id' in lineItem.subscription
      ) {
        logOperationalEvent.log(
          `invoice.lineItem.subscription is object: ${lineItem.subscription.id}`
        );
        return lineItem.subscription.id;
      }

      const lineItemAny = lineItem as {
        parent?: { subscription_item_details?: { subscription?: string } };
      };
      if (lineItemAny.parent?.subscription_item_details?.subscription) {
        const subscriptionId =
          lineItemAny.parent.subscription_item_details.subscription;
        logOperationalEvent.log(
          `invoice.lineItem.parent.subscription_item_details.subscription is string: ${subscriptionId}`
        );
        return subscriptionId;
      }

      if (typeof lineItem.subscription_item === 'string') {
        logOperationalEvent.log(
          `invoice.lineItem.subscription_item is string: ${lineItem.subscription_item}`
        );
        return lineItem.subscription_item;
      }
      if (
        lineItem.subscription_item &&
        typeof lineItem.subscription_item === 'object' &&
        'id' in lineItem.subscription_item
      ) {
        logOperationalEvent.log(
          `invoice.lineItem.subscription_item is object: ${lineItem.subscription_item.id}`
        );
        return lineItem.subscription_item.id;
      }
    }

    return null;
  }

  private getPeriodStart(subscription: Stripe.Subscription): Date | undefined {
    const s = subscription as Stripe.Subscription & {
      current_period_start?: number;
      items?: { data?: { current_period_start?: number }[] };
    };
    const startUnix =
      s.current_period_start ??
      s?.items?.data?.[0]?.current_period_start ??
      undefined;
    return typeof startUnix === 'number'
      ? new Date(startUnix * 1000)
      : undefined;
  }

  private getPeriodEnd(subscription: Stripe.Subscription): Date | undefined {
    const s = subscription as Stripe.Subscription & {
      current_period_end?: number;
      items?: { data?: { current_period_end?: number }[] };
    };
    const endUnix =
      s.current_period_end ??
      s?.items?.data?.[0]?.current_period_end ??
      undefined;
    return typeof endUnix === 'number' ? new Date(endUnix * 1000) : undefined;
  }

  /**
   * Map application locale to Stripe's supported locale values.
   */
  private mapLocaleToStripeLocale(
    locale: string
  ): Stripe.Checkout.SessionCreateParams.Locale {
    const stripeLocales = [
      'bg',
      'cs',
      'da',
      'de',
      'el',
      'en',
      'es',
      'et',
      'fi',
      'fil',
      'fr',
      'hr',
      'hu',
      'id',
      'it',
      'ja',
      'ko',
      'lt',
      'lv',
      'ms',
      'mt',
      'nb',
      'nl',
      'pl',
      'pt',
      'ro',
      'ru',
      'sk',
      'sl',
      'sv',
      'th',
      'tr',
      'vi',
      'zh',
    ] as const;

    if (stripeLocales.some((supported) => supported === locale)) {
      return locale as Stripe.Checkout.SessionCreateParams.Locale;
    }

    const baseLocale = locale.split('-')[0];
    if (stripeLocales.some((supported) => supported === baseLocale)) {
      return baseLocale as Stripe.Checkout.SessionCreateParams.Locale;
    }

    return 'auto';
  }
}
