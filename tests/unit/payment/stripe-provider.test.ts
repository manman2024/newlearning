import Stripe from 'stripe';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  findPlanByPlanId: vi.fn(),
  findPriceInPlan: vi.fn(),
  sendPaymentNotification: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: () => dbMocks,
}));

vi.mock('@/lib/price-plan', () => ({
  findPlanByPlanId: providerMocks.findPlanByPlanId,
  findPriceInPlan: providerMocks.findPriceInPlan,
}));

vi.mock('@/notification', () => ({
  sendPaymentNotification: providerMocks.sendPaymentNotification,
}));

import { StripeProvider } from '@/payment/provider/stripe';
import { user } from '@/db/auth.schema';

const WEBHOOK_SECRET = 'whsec_stripe_provider_test_secret';
const monthlyPrice = {
  type: 'subscription' as const,
  priceId: 'price_month',
  amount: 990,
  currency: 'USD',
  interval: 'month' as const,
  trialPeriodDays: 7,
};
const lifetimePrice = {
  type: 'one_time' as const,
  priceId: 'price_lifetime',
  amount: 19900,
  currency: 'USD',
  allowPromotionCode: true,
};
const proPlan = { id: 'pro', prices: [monthlyPrice] };
const lifetimePlan = { id: 'lifetime', prices: [lifetimePrice] };

type MockFunction = ReturnType<typeof vi.fn>;

type StripeClientTestDouble = {
  customers: { list: MockFunction; create: MockFunction };
  checkout: {
    sessions: {
      create: MockFunction;
      retrieve: MockFunction;
      list: MockFunction;
    };
  };
  subscriptions: { retrieve: MockFunction };
  invoices: { retrieve: MockFunction };
  billingPortal: { sessions: { create: MockFunction } };
};

let eventNumber = 0;

function configureInsert() {
  dbMocks.insert.mockReturnValue({ values: dbMocks.values });
  dbMocks.values.mockResolvedValue(undefined);
}

function configureSelect(rows: unknown[]) {
  configureSelectSequence([rows]);
}

function configureSelectSequence(rowsList: unknown[][]) {
  for (const rows of rowsList) {
    const chain = {
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockResolvedValue(rows);
    dbMocks.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue(chain),
    });
  }
}

function configureUpdate(rows: unknown[] = [{ id: 'payment_test' }]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  dbMocks.update.mockReturnValue({ set });
  return { set, where, returning };
}

function getStripeClient(provider: StripeProvider): StripeClientTestDouble {
  return (provider as unknown as { stripe: StripeClientTestDouble }).stripe;
}

function configureStripeClient(provider: StripeProvider) {
  const client = getStripeClient(provider);
  client.customers.list = vi.fn().mockResolvedValue({ data: [] });
  client.customers.create = vi.fn();
  client.checkout.sessions.create = vi.fn();
  client.checkout.sessions.retrieve = vi.fn();
  client.checkout.sessions.list = vi.fn();
  client.subscriptions.retrieve = vi.fn();
  client.invoices.retrieve = vi.fn();
  client.billingPortal.sessions.create = vi.fn();
  return client;
}

function subscription(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const periodStart = 1_754_000_000;
  const periodEnd = 1_756_592_000;
  return {
    id: 'sub_test',
    object: 'subscription',
    customer: 'cus_test',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_start: null,
    trial_end: null,
    metadata: { userId: 'user_test' },
    items: {
      data: [
        {
          price: { id: 'price_month' },
          plan: { interval: 'month' },
          current_period_start: periodStart,
          current_period_end: periodEnd,
        },
      ],
    },
    ...overrides,
  };
}

function paymentRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'payment_test',
    priceId: 'price_month',
    userId: 'user_test',
    customerId: 'cus_test',
    subscriptionId: 'sub_test',
    sessionId: 'cs_test',
    invoiceId: 'in_test',
    type: 'subscription',
    scene: 'subscription',
    interval: 'month',
    status: 'active',
    paid: false,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    trialStart: null,
    trialEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function signedEvent(type: string, object: Record<string, unknown>) {
  eventNumber += 1;
  const payload = JSON.stringify({
    id: `evt_provider_${eventNumber}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

async function dispatch(
  provider: StripeProvider,
  type: string,
  object: Record<string, unknown>
) {
  const event = signedEvent(type, object);
  await provider.handleWebhookEvent(event.payload, event.signature);
}

describe('Stripe provider lifecycle', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_provider_key';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    eventNumber = 0;

    dbMocks.insert.mockReset();
    dbMocks.values.mockReset();
    dbMocks.select.mockReset();
    dbMocks.update.mockReset();
    providerMocks.findPlanByPlanId.mockReset();
    providerMocks.findPriceInPlan.mockReset();
    providerMocks.sendPaymentNotification.mockReset();
    providerMocks.sendPaymentNotification.mockResolvedValue(undefined);

    providerMocks.findPlanByPlanId.mockImplementation((planId: string) => {
      if (planId === 'pro') return proPlan;
      if (planId === 'lifetime') return lifetimePlan;
      return undefined;
    });
    providerMocks.findPriceInPlan.mockImplementation(
      (_planId: string, priceId: string) => {
        if (priceId === monthlyPrice.priceId) return monthlyPrice;
        if (priceId === lifetimePrice.priceId) return lifetimePrice;
        return undefined;
      }
    );
    configureInsert();
  });

  test('creates a subscription checkout with metadata, locale, and trial', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelect([{ id: 'user_test' }]);
    stripe.customers.list.mockResolvedValue({
      data: [{ id: 'cus_existing' }],
    });
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test',
      url: 'https://checkout.stripe.com/cs_test',
    });

    await expect(
      provider.createCheckout({
        planId: 'pro',
        priceId: 'price_month',
        customerEmail: 'buyer@example.com',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        locale: 'zh-CN',
        metadata: { userId: 'user_test', userName: 'Buyer' },
      })
    ).resolves.toEqual({
      id: 'cs_test',
      url: 'https://checkout.stripe.com/cs_test',
    });

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_existing',
        mode: 'subscription',
        line_items: [{ price: 'price_month', quantity: 1 }],
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        locale: 'zh',
        metadata: {
          userId: 'user_test',
          userName: 'Buyer',
          planId: 'pro',
          priceId: 'price_month',
        },
        subscription_data: {
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            planId: 'pro',
            priceId: 'price_month',
          },
          trial_period_days: 7,
        },
      })
    );
  });

  test('creates a lifetime checkout with invoice creation and payment metadata', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelect([]);
    const update = configureUpdate([{ id: 'user_test' }]);
    stripe.customers.create.mockResolvedValue({ id: 'cus_new' });
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_lifetime',
      url: 'https://checkout.stripe.com/cs_lifetime',
    });

    await provider.createCheckout({
      planId: 'lifetime',
      priceId: 'price_lifetime',
      customerEmail: 'buyer@example.com',
      metadata: { userId: 'user_test' },
    });

    expect(stripe.customers.create).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      name: undefined,
    });
    expect(dbMocks.update).toHaveBeenCalledExactlyOnceWith(user);
    expect(update.set).toHaveBeenCalledExactlyOnceWith({
      customerId: 'cus_new',
      updatedAt: expect.any(Date),
    });
    expect(update.where).toHaveBeenCalledOnce();
    expect(
      new SQLiteSyncDialect().sqlToQuery(update.where.mock.calls[0][0])
    ).toMatchObject({
      sql: '"user"."email" = ?',
      params: ['buyer@example.com'],
    });
    expect(update.returning).toHaveBeenCalledExactlyOnceWith({ id: user.id });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_new',
        mode: 'payment',
        allow_promotion_codes: true,
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata: {
              userId: 'user_test',
              planId: 'lifetime',
              priceId: 'price_lifetime',
            },
          },
        },
        payment_intent_data: {
          metadata: {
            userId: 'user_test',
            planId: 'lifetime',
            priceId: 'price_lifetime',
          },
        },
      })
    );
  });

  test('creates a Customer Portal session with the mapped locale', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    stripe.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://billing.stripe.com/session_test',
    });

    await expect(
      provider.createCustomerPortal({
        customerId: 'cus_test',
        returnUrl: 'https://example.com/settings/billing',
        locale: 'zh-CN',
      })
    ).resolves.toEqual({
      url: 'https://billing.stripe.com/session_test',
    });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_test',
      return_url: 'https://example.com/settings/billing',
      locale: 'zh',
    });
  });

  test('records a subscription checkout as an unpaid subscription row', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());

    await dispatch(provider, 'checkout.session.completed', {
      id: 'cs_test',
      object: 'checkout.session',
      customer: 'cus_test',
      subscription: 'sub_test',
      invoice: 'in_test',
      metadata: { userId: 'user_test', priceId: 'price_month' },
      mode: 'subscription',
    });

    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test',
        invoiceId: 'in_test',
        paid: false,
        priceId: 'price_month',
        scene: 'subscription',
        sessionId: 'cs_test',
        status: 'active',
        type: 'subscription',
        userId: 'user_test',
      })
    );
  });

  test('keeps a Stripe-confirmed subscription checkout pending until invoice.paid', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());

    await dispatch(provider, 'checkout.session.completed', {
      id: 'cs_test',
      object: 'checkout.session',
      customer: 'cus_test',
      subscription: 'sub_test',
      invoice: 'in_test',
      metadata: { userId: 'user_test', priceId: 'price_month' },
      mode: 'subscription',
      payment_status: 'paid',
    });

    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false })
    );
  });

  test('reconstructs a paid subscription when invoice.paid arrives before checkout', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelectSequence([[], []]);
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_test',
          object: 'checkout.session',
          customer: 'cus_test',
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            priceId: 'price_month',
          },
          mode: 'subscription',
          subscription: 'sub_test',
        },
      ],
    });

    await dispatch(provider, 'invoice.paid', {
      id: 'in_test',
      object: 'invoice',
      customer: 'cus_test',
      subscription: 'sub_test',
    });

    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      subscription: 'sub_test',
      limit: 10,
    });
    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test',
        invoiceId: 'in_test',
        paid: true,
        priceId: 'price_month',
        scene: 'subscription',
        sessionId: 'cs_test',
        status: 'active',
        subscriptionId: 'sub_test',
        type: 'subscription',
        userId: 'user_test',
      })
    );
  });

  test('makes invoice.paid win when checkout creates the row during reconstruction', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelectSequence([[], [], [paymentRecord()]]);
    const update = configureUpdate();
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_test',
          customer: 'cus_test',
          metadata: { userId: 'user_test', priceId: 'price_month' },
          mode: 'subscription',
          subscription: 'sub_test',
        },
      ],
    });
    dbMocks.values.mockRejectedValueOnce(
      new Error('Failed query: insert into payment', {
        cause: new Error(
          'D1_ERROR: UNIQUE constraint failed: payment.invoice_id'
        ),
      })
    );

    await dispatch(provider, 'invoice.paid', {
      id: 'in_test',
      object: 'invoice',
      customer: 'cus_test',
      subscription: 'sub_test',
    });

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: true, status: 'active' })
    );
  });

  test('marks a subscription paid after invoice.paid', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelect([paymentRecord()]);
    const update = configureUpdate();
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());

    await dispatch(provider, 'invoice.paid', {
      id: 'in_test',
      object: 'invoice',
      customer: 'cus_test',
      subscription: 'sub_test',
    });

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        paid: true,
        status: 'active',
        interval: 'month',
        cancelAtPeriodEnd: false,
      })
    );
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_test');
  });

  test('updates the existing row on a renewal invoice without a new payment row', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelectSequence([[], [paymentRecord()], [{ id: 'user_test' }]]);
    const update = configureUpdate();
    stripe.subscriptions.retrieve.mockResolvedValue(
      subscription({ metadata: {} })
    );

    await dispatch(provider, 'invoice.paid', {
      id: 'in_renewal',
      object: 'invoice',
      customer: 'cus_test',
      subscription: 'sub_test',
    });

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: true, status: 'active' })
    );
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  test('marks a lifetime payment paid and sends its notification after invoice.paid', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelect([
      paymentRecord({
        type: 'one_time',
        scene: 'lifetime',
        subscriptionId: null,
      }),
    ]);
    const update = configureUpdate();
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test',
      metadata: { userName: 'Buyer' },
    });

    await dispatch(provider, 'invoice.paid', {
      id: 'in_test',
      object: 'invoice',
      customer: 'cus_test',
      subscription: null,
      amount_paid: 19900,
    });

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: true, status: 'completed' })
    );
    expect(providerMocks.sendPaymentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test',
        sessionId: 'cs_test',
        userName: 'Buyer',
      })
    );
  });

  test('reconstructs a paid lifetime payment when invoice.paid arrives before checkout', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    // findPaymentRecord (invoiceId) then the reconstruct sessionId lookup.
    configureSelectSequence([[], []]);
    stripe.invoices.retrieve.mockResolvedValue({
      id: 'in_lifetime',
      payment_intent: 'pi_lifetime',
    });
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_lifetime',
          object: 'checkout.session',
          customer: 'cus_test',
          invoice: 'in_lifetime',
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            priceId: 'price_lifetime',
          },
          mode: 'payment',
          payment_intent: 'pi_lifetime',
        },
      ],
    });

    await dispatch(provider, 'invoice.paid', {
      id: 'in_lifetime',
      object: 'invoice',
      amount_paid: 19900,
      customer: 'cus_test',
      payment_intent: null,
      subscription: null,
    });

    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_lifetime');
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      payment_intent: 'pi_lifetime',
      limit: 10,
    });
    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test',
        invoiceId: 'in_lifetime',
        paid: true,
        priceId: 'price_lifetime',
        scene: 'lifetime',
        sessionId: 'cs_lifetime',
        status: 'completed',
        type: 'one_time',
        userId: 'user_test',
      })
    );
    expect(providerMocks.sendPaymentNotification).toHaveBeenCalledWith({
      amount: 199,
      customerId: 'cus_test',
      sessionId: 'cs_lifetime',
      userName: 'Buyer',
    });
  });

  test('reconstructs a zero-cost lifetime payment that has no PaymentIntent', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    // findPaymentRecord (invoiceId) then the reconstruct sessionId lookup.
    configureSelectSequence([[], []]);
    // A $0 order has no PaymentIntent, so retrieving the invoice still yields
    // none and the session must be matched by customer + invoice id.
    stripe.invoices.retrieve.mockResolvedValue({ id: 'in_zero' });
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_zero',
          object: 'checkout.session',
          customer: 'cus_test',
          invoice: 'in_zero',
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            priceId: 'price_lifetime',
          },
          mode: 'payment',
          payment_intent: null,
        },
      ],
    });

    await dispatch(provider, 'invoice.paid', {
      id: 'in_zero',
      object: 'invoice',
      amount_paid: 0,
      customer: 'cus_test',
      payment_intent: null,
      subscription: null,
    });

    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      customer: 'cus_test',
      limit: 100,
    });
    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test',
        invoiceId: 'in_zero',
        paid: true,
        priceId: 'price_lifetime',
        scene: 'lifetime',
        sessionId: 'cs_zero',
        status: 'completed',
        type: 'one_time',
        userId: 'user_test',
      })
    );
    expect(providerMocks.sendPaymentNotification).toHaveBeenCalledWith({
      amount: 0,
      customerId: 'cus_test',
      sessionId: 'cs_zero',
      userName: 'Buyer',
    });
  });

  test('keeps the reconstructed paid row when checkout arrives afterward', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    // findPaymentRecord (invoiceId) then the reconstruct sessionId lookup.
    configureSelectSequence([[], []]);
    stripe.invoices.retrieve.mockResolvedValue({
      id: 'in_lifetime',
      payment_intent: 'pi_lifetime',
    });
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_lifetime',
          customer: 'cus_test',
          invoice: 'in_lifetime',
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            priceId: 'price_lifetime',
          },
          mode: 'payment',
          payment_intent: 'pi_lifetime',
        },
      ],
    });
    dbMocks.values
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error('D1_ERROR: UNIQUE constraint failed: payment.invoice_id')
      );

    await dispatch(provider, 'invoice.paid', {
      id: 'in_lifetime',
      object: 'invoice',
      amount_paid: 19900,
      customer: 'cus_test',
      payment_intent: null,
      subscription: null,
    });
    await dispatch(provider, 'checkout.session.completed', {
      id: 'cs_lifetime',
      object: 'checkout.session',
      customer: 'cus_test',
      invoice: 'in_lifetime',
      metadata: { userId: 'user_test', priceId: 'price_lifetime' },
      mode: 'payment',
      payment_status: 'paid',
    });

    expect(dbMocks.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ paid: true })
    );
    expect(dbMocks.values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ paid: false })
    );
    expect(providerMocks.sendPaymentNotification).toHaveBeenCalledTimes(1);
  });

  test('updates an existing unpaid lifetime row by sessionId instead of duplicating it', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    // findPaymentRecord (invoiceId miss, the checkout row still has a null
    // invoiceId) then the reconstruct sessionId lookup that finds the row.
    configureSelectSequence([
      [],
      [
        paymentRecord({
          type: 'one_time',
          scene: 'lifetime',
          subscriptionId: null,
          invoiceId: null,
          sessionId: 'cs_lifetime',
          paid: false,
        }),
      ],
    ]);
    const update = configureUpdate();
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_lifetime',
          customer: 'cus_test',
          invoice: 'in_lifetime',
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            priceId: 'price_lifetime',
          },
          mode: 'payment',
          payment_intent: 'pi_lifetime',
        },
      ],
    });
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_lifetime',
      metadata: { userName: 'Buyer' },
    });

    await dispatch(provider, 'invoice.paid', {
      id: 'in_lifetime',
      object: 'invoice',
      amount_paid: 19900,
      customer: 'cus_test',
      payment_intent: 'pi_lifetime',
      subscription: null,
    });

    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: true, status: 'completed' })
    );
    expect(providerMocks.sendPaymentNotification).toHaveBeenCalledTimes(1);
  });

  test('does not send the lifetime notification again for a duplicate invoice', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    // First delivery: findPaymentRecord miss, reconstruct sessionId lookup miss,
    // then insert. Second delivery: findPaymentRecord finds the paid row.
    configureSelectSequence([
      [],
      [],
      [
        paymentRecord({
          type: 'one_time',
          scene: 'lifetime',
          subscriptionId: null,
          invoiceId: 'in_lifetime',
          paid: true,
        }),
      ],
    ]);
    configureUpdate();
    stripe.invoices.retrieve.mockResolvedValue({
      id: 'in_lifetime',
      payment_intent: 'pi_lifetime',
    });
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [
        {
          id: 'cs_test',
          customer: 'cus_test',
          metadata: {
            userId: 'user_test',
            userName: 'Buyer',
            priceId: 'price_lifetime',
          },
          mode: 'payment',
        },
      ],
    });
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test',
      metadata: { userName: 'Buyer' },
    });
    const invoice = {
      id: 'in_lifetime',
      object: 'invoice',
      amount_paid: 19900,
      customer: 'cus_test',
      payment_intent: null,
      subscription: null,
    };

    await dispatch(provider, 'invoice.paid', invoice);
    await dispatch(provider, 'invoice.paid', invoice);

    expect(providerMocks.sendPaymentNotification).toHaveBeenCalledTimes(1);
  });

  test('does not notify when another invoice delivery wins the paid transition', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    configureSelect([
      paymentRecord({
        type: 'one_time',
        scene: 'lifetime',
        subscriptionId: null,
        paid: false,
      }),
    ]);
    configureUpdate([]);
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_test',
      metadata: { userName: 'Buyer' },
    });

    await dispatch(provider, 'invoice.paid', {
      id: 'in_test',
      object: 'invoice',
      amount_paid: 19900,
      customer: 'cus_test',
      subscription: null,
    });

    expect(providerMocks.sendPaymentNotification).not.toHaveBeenCalled();
  });

  test('updates cancellation state and subscription status from webhook events', async () => {
    const provider = new StripeProvider();
    const update = configureUpdate();

    await dispatch(
      provider,
      'customer.subscription.updated',
      subscription({
        status: 'past_due',
        cancel_at_period_end: true,
      })
    );
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'past_due',
        cancelAtPeriodEnd: true,
      })
    );

    update.set.mockClear();
    await dispatch(
      provider,
      'customer.subscription.deleted',
      subscription({ status: 'canceled' })
    );
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' })
    );
  });

  test('persists a subscription price and billing period change', async () => {
    const provider = new StripeProvider();
    const update = configureUpdate();
    const periodStart = 1_756_592_000;
    const periodEnd = 1_788_128_000;

    await dispatch(
      provider,
      'customer.subscription.updated',
      subscription({
        current_period_start: periodStart,
        current_period_end: periodEnd,
        items: {
          data: [
            {
              price: { id: 'price_year' },
              plan: { interval: 'year' },
              current_period_start: periodStart,
              current_period_end: periodEnd,
            },
          ],
        },
      })
    );

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: 'price_year',
        interval: 'year',
        periodStart: new Date(periodStart * 1000),
        periodEnd: new Date(periodEnd * 1000),
      })
    );
  });

  test('revokes a lifetime payment after a full charge refund', async () => {
    const provider = new StripeProvider();
    const update = configureUpdate();

    await dispatch(provider, 'charge.refunded', {
      id: 'ch_test',
      object: 'charge',
      customer: 'cus_test',
      invoice: 'in_refunded',
      refunded: true,
    });

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false, status: 'canceled' })
    );
    const query = new SQLiteSyncDialect().sqlToQuery(
      update.where.mock.calls[0][0]
    );
    expect(query.sql).toContain('"payment"."invoice_id" = ?');
    expect(query.params).toContain('in_refunded');
  });

  test('resolves the matching checkout when a refund has no invoice', async () => {
    const provider = new StripeProvider();
    const stripe = configureStripeClient(provider);
    const update = configureUpdate();
    stripe.checkout.sessions.list.mockResolvedValue({
      data: [{ id: 'cs_refunded' }],
    });

    await dispatch(provider, 'charge.refunded', {
      id: 'ch_test',
      object: 'charge',
      customer: 'cus_test',
      invoice: null,
      payment_intent: 'pi_refunded',
      refunded: true,
    });

    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      payment_intent: 'pi_refunded',
      limit: 1,
    });
    const query = new SQLiteSyncDialect().sqlToQuery(
      update.where.mock.calls[0][0]
    );
    expect(query.sql).toContain('"payment"."session_id" = ?');
    expect(query.params).toContain('cs_refunded');
  });

  test('keeps lifetime access for a partial charge refund', async () => {
    const provider = new StripeProvider();
    configureUpdate();

    await dispatch(provider, 'charge.refunded', {
      id: 'ch_test',
      object: 'charge',
      customer: 'cus_test',
      invoice: 'in_test',
      refunded: false,
    });

    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  test('does not reactivate a refunded lifetime payment on invoice replay', async () => {
    const provider = new StripeProvider();
    configureStripeClient(provider);
    configureSelect([
      paymentRecord({
        type: 'one_time',
        scene: 'lifetime',
        subscriptionId: null,
        status: 'canceled',
        paid: false,
      }),
    ]);
    const update = configureUpdate([]);

    await dispatch(provider, 'invoice.paid', {
      id: 'in_test',
      object: 'invoice',
      amount_paid: 19900,
      customer: 'cus_test',
      subscription: null,
    });

    const query = new SQLiteSyncDialect().sqlToQuery(
      update.where.mock.calls[0][0]
    );
    expect(query.sql).toContain('"payment"."status" = ?');
    expect(query.params).toContain('completed');
    expect(providerMocks.sendPaymentNotification).not.toHaveBeenCalled();
  });
});
