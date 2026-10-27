import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import Stripe from 'stripe';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  waitForE2EPayment,
  waitForPaidPayment,
} from '../fixtures/auth';
import type { E2EUser } from '../fixtures/test-data';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey?.startsWith('sk_test_')) {
  throw new Error('Stripe sandbox tests require an sk_test_ key');
}

const stripe = new Stripe(stripeSecretKey);

type CheckoutScenario = {
  planId: 'lifetime' | 'pro';
  expectedPriceId: string;
  interval?: 'month' | 'year';
  openPortal?: boolean;
  cardNumber?: string;
  zeroCostPromotionCode?: string;
};

type CheckoutArtifacts = {
  subscriptionId?: string;
  sessionId?: string;
  paymentIntentId?: string;
};

async function fillStripeField(page: Page, label: RegExp, value: string) {
  const field = page.getByRole('textbox', { name: label }).first();
  await field.waitFor({ state: 'visible', timeout: 60_000 });
  await field.fill(value);
}

async function cleanupStripeE2ECustomers() {
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    const email = customer.email ?? '';
    if (email.startsWith('e2e-stripe-') && email.endsWith('@example.test')) {
      await stripe.customers.del(customer.id);
    }
  }
}

async function assertPortalPlanChangesEnabled() {
  const configurations = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  const configuration = configurations.data.find((item) => item.is_default);
  const subscriptionUpdate = configuration?.features.subscription_update;

  if (
    !subscriptionUpdate?.enabled ||
    !subscriptionUpdate.default_allowed_updates.includes('price')
  ) {
    throw new Error(
      'Stripe Test Mode Customer Portal must allow subscription price updates'
    );
  }
}

async function waitForStripeSubscriptionPrice(
  subscriptionId: string,
  priceId: string
) {
  await expect
    .poll(
      async () => {
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        return subscription.items.data[0]?.price.id;
      },
      { timeout: 60_000 }
    )
    .toBe(priceId);

  return stripe.subscriptions.retrieve(subscriptionId);
}

async function changeStripePortalInterval(
  page: Page,
  interval: 'Monthly' | 'Yearly'
) {
  await page.waitForURL(/https:\/\/billing\.stripe\.com\//, {
    timeout: 60_000,
  });
  const intervalOption = page.getByRole('radio', { name: interval });
  if (!(await intervalOption.isVisible())) {
    const actionName = /update subscription|update plan|change plan/i;
    const button = page.getByRole('button', { name: actionName }).first();
    const link = page.getByRole('link', { name: actionName }).first();
    if (await button.isVisible()) {
      await button.click();
    } else {
      await link.click();
    }
  }

  await intervalOption.waitFor({ state: 'visible', timeout: 60_000 });
  await intervalOption.click();
  const selectButton = page.getByRole('button', { name: /^select$/i });
  if (await selectButton.isVisible()) await selectButton.click();

  const continueButton = page.getByRole('button', { name: /^continue$/i });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  const confirmButton = page.getByRole('button', {
    name: /^(confirm|update subscription|apply changes)$/i,
  });
  try {
    await confirmButton.waitFor({ state: 'visible', timeout: 15_000 });
    await confirmButton.click();
  } catch {
    // Some Portal configurations apply the change from Continue directly.
  }
}

function expectBillingPeriodMatches(
  periodStart: string | number | null,
  periodEnd: string | number | null,
  subscription: Stripe.Subscription
) {
  expect(typeof subscription.current_period_start).toBe('number');
  expect(typeof subscription.current_period_end).toBe('number');
  expect(new Date(periodStart ?? 0).getTime()).toBe(
    subscription.current_period_start * 1000
  );
  expect(new Date(periodEnd ?? 0).getTime()).toBe(
    subscription.current_period_end * 1000
  );
}

async function fillStripeCheckout(
  page: Page,
  user: E2EUser,
  scenario: CheckoutScenario
): Promise<Locator> {
  await loginByForm(page, user);
  await page.goto('/pricing');
  await page.waitForLoadState('networkidle');

  if (scenario.interval === 'year') {
    await page.getByTestId('pricing-interval-year').click();
  }

  const planCard = page.getByTestId(`pricing-card-${scenario.planId}`);
  await planCard.getByRole('button').click();

  await page.waitForURL(/https:\/\/checkout\.stripe\.com\//, {
    timeout: 60_000,
  });
  await page
    .getByRole('textbox', { name: /card number/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  const emailField = page.getByLabel(/email/i).first();
  if ((await emailField.count()) > 0 && (await emailField.isEditable())) {
    await emailField.fill(user.email);
  }

  if (scenario.zeroCostPromotionCode) {
    await page
      .locator('input[name="promotionCode"]')
      .filter({ visible: true })
      .fill(scenario.zeroCostPromotionCode);
    await page
      .getByRole('button', { name: /^apply$/i })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: /card number/i })
    ).toBeHidden();

    return page
      .getByRole('button', { name: /complete order|subscribe|pay/i })
      .first();
  }

  await fillStripeField(
    page,
    /card number/i,
    scenario.cardNumber ?? '4242424242424242'
  );
  await fillStripeField(page, /expiration|expiry/i, '1230');
  await fillStripeField(page, /security code|cvc/i, '123');

  const nameField = page
    .getByRole('textbox', { name: /cardholder name|name on card/i })
    .first();
  if ((await nameField.count()) > 0 && (await nameField.isEditable())) {
    await nameField.fill(user.name);
  }
  const postalField = page
    .getByRole('textbox', { name: /zip|postal/i })
    .first();
  if ((await postalField.count()) > 0 && (await postalField.isEditable())) {
    await postalField.fill('94107');
  }

  return page
    .getByRole('button', { name: /subscribe|pay|complete order/i })
    .first();
}

async function completeStripeCheckout(
  page: Page,
  user: E2EUser,
  scenario: CheckoutScenario
): Promise<CheckoutArtifacts> {
  const payButton = await fillStripeCheckout(page, user, scenario);
  await payButton.click();
  await page.waitForURL(/\/settings\/billing/, { timeout: 120_000 });

  const customers = await stripe.customers.list({
    email: user.email,
    limit: 10,
  });
  expect(customers.data).toHaveLength(1);
  const customer = customers.data[0];
  if (!customer || ('deleted' in customer && customer.deleted)) {
    throw new Error(`Stripe customer was not found for ${user.email}`);
  }

  const artifacts: CheckoutArtifacts = {};

  if (scenario.interval) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 10,
    });
    expect(subscriptions.data).toHaveLength(1);
    expect(subscriptions.data[0].items.data[0]?.price.id).toBe(
      scenario.expectedPriceId
    );
    artifacts.subscriptionId = subscriptions.data[0]?.id;
  } else {
    const sessions = await stripe.checkout.sessions.list({
      customer: customer.id,
      limit: 10,
      status: 'complete',
    });
    expect(sessions.data).toHaveLength(1);
    const lineItems = await stripe.checkout.sessions.listLineItems(
      sessions.data[0].id,
      { limit: 10 }
    );
    expect(lineItems.data[0]?.price?.id).toBe(scenario.expectedPriceId);
    artifacts.sessionId = sessions.data[0]?.id;
    const paymentIntent = sessions.data[0]?.payment_intent;
    if (typeof paymentIntent === 'string') {
      artifacts.paymentIntentId = paymentIntent;
    }
  }

  if (scenario.openPortal) {
    await page.getByTestId('customer-portal-button').click();
    await page.waitForURL(/https:\/\/billing\.stripe\.com\//, {
      timeout: 60_000,
    });
  }

  return artifacts;
}

async function waitForPaidSnapshot(request: APIRequestContext, email: string) {
  const state = await waitForE2EPayment(request, email, {
    paidOnly: true,
    predicate: (current) => current.latestPayment?.paid === true,
  });
  if (!state?.latestPayment) {
    throw new Error(`No paid Stripe payment row found for ${email}`);
  }
  expect(state.paymentCount).toBe(1);
  return state;
}

test.describe
  .serial('Stripe sandbox payment flows', () => {
    const paidEmails = new Set<string>();
    let zeroCostCouponId: string | undefined;
    let zeroCostPromotionCodeId: string | undefined;
    let zeroCostPromotionCode: string | undefined;

    test.beforeAll(async ({ request }) => {
      await cleanupStripeE2ECustomers();
      await cleanupE2EUsers(request);

      const suffix = Date.now().toString(36).toUpperCase();
      const coupon = await stripe.coupons.create({
        duration: 'once',
        name: `E2E zero-cost ${suffix}`,
        percent_off: 100,
      });
      const promotionCode = await stripe.promotionCodes.create({
        code: `E2EZERO${suffix}`,
        coupon: coupon.id,
        max_redemptions: 1,
      });
      zeroCostCouponId = coupon.id;
      zeroCostPromotionCodeId = promotionCode.id;
      zeroCostPromotionCode = promotionCode.code;
    });

    test.afterEach(async ({ request }) => {
      for (const email of paidEmails) {
        await waitForPaidPayment(request, email, { timeoutMs: 30_000 });
      }
      paidEmails.clear();
      await cleanupE2EUsers(request);
    });

    test.afterAll(async () => {
      await cleanupStripeE2ECustomers();
      if (zeroCostPromotionCodeId) {
        await stripe.promotionCodes.update(zeroCostPromotionCodeId, {
          active: false,
        });
      }
      if (zeroCostCouponId) {
        await stripe.coupons.del(zeroCostCouponId);
      }
    });

    test('changes a monthly subscription to yearly and back in Customer Portal', async ({
      page,
      request,
    }) => {
      await assertPortalPlanChangesEnabled();
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-month-${Date.now()}@example.test`,
      });
      paidEmails.add(user.email);

      const monthlyPriceId = process.env.VITE_STRIPE_PRICE_PRO_MONTHLY ?? '';
      const yearlyPriceId = process.env.VITE_STRIPE_PRICE_PRO_YEARLY ?? '';
      const artifacts = await completeStripeCheckout(page, user, {
        planId: 'pro',
        expectedPriceId: monthlyPriceId,
        interval: 'month',
        openPortal: true,
      });
      if (!artifacts.subscriptionId) {
        throw new Error('Stripe subscription id was not returned');
      }

      const initial = await waitForPaidSnapshot(request, user.email);
      expect(initial.latestPayment).toMatchObject({
        interval: 'month',
        paid: true,
        priceId: monthlyPriceId,
        scene: 'subscription',
        status: 'active',
        type: 'subscription',
      });
      expect(initial.latestPayment?.periodEnd).not.toBeNull();

      await changeStripePortalInterval(page, 'Yearly');
      const yearlySubscription = await waitForStripeSubscriptionPrice(
        artifacts.subscriptionId,
        yearlyPriceId
      );
      const yearly = await waitForE2EPayment(request, user.email, {
        paidOnly: true,
        predicate: (state) =>
          state.subscription?.priceId === yearlyPriceId &&
          state.subscription.interval === 'year',
      });
      expect(yearly?.subscription).toMatchObject({
        priceId: yearlyPriceId,
        interval: 'year',
      });
      expectBillingPeriodMatches(
        yearly?.subscription?.periodStart ?? null,
        yearly?.subscription?.periodEnd ?? null,
        yearlySubscription
      );

      await page.goto('/settings/billing');
      await page.getByTestId('customer-portal-button').click();
      await changeStripePortalInterval(page, 'Monthly');
      const monthlySubscription = await waitForStripeSubscriptionPrice(
        artifacts.subscriptionId,
        monthlyPriceId
      );
      const monthly = await waitForE2EPayment(request, user.email, {
        paidOnly: true,
        predicate: (state) =>
          state.subscription?.priceId === monthlyPriceId &&
          state.subscription.interval === 'month',
      });
      expect(monthly?.subscription).toMatchObject({
        priceId: monthlyPriceId,
        interval: 'month',
      });
      expectBillingPeriodMatches(
        monthly?.subscription?.periodStart ?? null,
        monthly?.subscription?.periodEnd ?? null,
        monthlySubscription
      );
    });

    test('completes a yearly subscription', async ({ page, request }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-year-${Date.now()}@example.test`,
      });
      paidEmails.add(user.email);

      await completeStripeCheckout(page, user, {
        planId: 'pro',
        expectedPriceId: process.env.VITE_STRIPE_PRICE_PRO_YEARLY ?? '',
        interval: 'year',
      });
      const state = await waitForPaidSnapshot(request, user.email);
      expect(state.latestPayment).toMatchObject({
        interval: 'year',
        paid: true,
        priceId: process.env.VITE_STRIPE_PRICE_PRO_YEARLY,
        scene: 'subscription',
        status: 'active',
        type: 'subscription',
      });
      expect(state.latestPayment?.periodEnd).not.toBeNull();
    });

    test('completes a one-time lifetime payment', async ({ page, request }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-lifetime-${Date.now()}@example.test`,
      });
      paidEmails.add(user.email);

      const artifacts = await completeStripeCheckout(page, user, {
        planId: 'lifetime',
        expectedPriceId: process.env.VITE_STRIPE_PRICE_LIFETIME ?? '',
      });
      const state = await waitForPaidSnapshot(request, user.email);
      expect(state.latestPayment).toMatchObject({
        paid: true,
        priceId: process.env.VITE_STRIPE_PRICE_LIFETIME,
        scene: 'lifetime',
        status: 'completed',
        type: 'one_time',
      });
      expect(state.latestPayment?.sessionId).toBe(artifacts.sessionId);
    });

    test('completes a zero-cost lifetime payment without a PaymentIntent', async ({
      page,
      request,
    }) => {
      if (!zeroCostPromotionCode) {
        throw new Error('Stripe zero-cost promotion code was not created');
      }
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-zero-${Date.now()}@example.test`,
      });
      paidEmails.add(user.email);

      const artifacts = await completeStripeCheckout(page, user, {
        planId: 'lifetime',
        expectedPriceId: process.env.VITE_STRIPE_PRICE_LIFETIME ?? '',
        zeroCostPromotionCode,
      });
      if (!artifacts.sessionId) {
        throw new Error('Stripe zero-cost session id was not returned');
      }

      const session = await stripe.checkout.sessions.retrieve(
        artifacts.sessionId
      );
      expect(session).toMatchObject({
        amount_total: 0,
        payment_intent: null,
        payment_status: 'paid',
      });
      if (typeof session.invoice !== 'string') {
        throw new Error('Stripe zero-cost invoice id was not returned');
      }
      const invoice = await stripe.invoices.retrieve(session.invoice);
      expect(invoice).toMatchObject({
        amount_paid: 0,
        payment_intent: null,
      });

      const state = await waitForPaidSnapshot(request, user.email);
      expect(state.latestPayment).toMatchObject({
        invoiceId: session.invoice,
        paid: true,
        priceId: process.env.VITE_STRIPE_PRICE_LIFETIME,
        scene: 'lifetime',
        sessionId: artifacts.sessionId,
        status: 'completed',
        type: 'one_time',
      });
    });

    test('rejects a declined card without creating a paid payment row', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-declined-${Date.now()}@example.test`,
      });

      const payButton = await fillStripeCheckout(page, user, {
        planId: 'pro',
        expectedPriceId: process.env.VITE_STRIPE_PRICE_PRO_MONTHLY ?? '',
        interval: 'month',
        cardNumber: '4000000000009995',
      });
      await payButton.click();

      const state = await waitForE2EPayment(request, user.email, {
        timeoutMs: 10_000,
      });
      expect(state?.paymentCount ?? 0).toBe(0);
    });

    test('persists subscription cancellation and deletion webhook state', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-cancel-${Date.now()}@example.test`,
      });
      paidEmails.add(user.email);

      const artifacts = await completeStripeCheckout(page, user, {
        planId: 'pro',
        expectedPriceId: process.env.VITE_STRIPE_PRICE_PRO_MONTHLY ?? '',
        interval: 'month',
      });
      if (!artifacts.subscriptionId) {
        throw new Error('Stripe subscription id was not returned');
      }

      await stripe.subscriptions.update(artifacts.subscriptionId, {
        cancel_at_period_end: true,
      });
      const scheduled = await waitForE2EPayment(request, user.email, {
        paidOnly: true,
        predicate: (state) => state.subscription?.cancelAtPeriodEnd === true,
      });
      expect(scheduled?.subscription).toMatchObject({
        cancelAtPeriodEnd: true,
        status: 'active',
      });

      await stripe.subscriptions.cancel(artifacts.subscriptionId);
      const canceled = await waitForE2EPayment(request, user.email, {
        paidOnly: true,
        predicate: (state) => state.subscription?.status === 'canceled',
      });
      expect(canceled?.subscription?.status).toBe('canceled');
    });

    test('revokes lifetime access after a full Stripe refund', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-stripe-refund-${Date.now()}@example.test`,
      });
      paidEmails.add(user.email);

      const artifacts = await completeStripeCheckout(page, user, {
        planId: 'lifetime',
        expectedPriceId: process.env.VITE_STRIPE_PRICE_LIFETIME ?? '',
      });
      if (!artifacts.sessionId) {
        throw new Error('Stripe lifetime session id was not returned');
      }

      const session = await stripe.checkout.sessions.retrieve(
        artifacts.sessionId
      );
      const paymentIntentId =
        artifacts.paymentIntentId ??
        (typeof session.payment_intent === 'string'
          ? session.payment_intent
          : undefined);
      if (!paymentIntentId) {
        throw new Error('Stripe payment intent id was not returned');
      }

      await stripe.refunds.create({ payment_intent: paymentIntentId });
      paidEmails.delete(user.email);
      const refunded = await waitForE2EPayment(request, user.email, {
        predicate: (state) => state.latestPayment?.paid === false,
      });
      expect(refunded?.paymentCount).toBe(1);
      expect(refunded?.latestPayment).toMatchObject({
        paid: false,
        scene: 'lifetime',
        status: 'canceled',
        type: 'one_time',
      });
    });
  });
