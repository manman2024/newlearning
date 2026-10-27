import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  waitForE2EPayment,
  waitForPaidPayment,
  waitForSubscription,
} from '../fixtures/auth';

test.describe('Waffo sandbox payment', () => {
  let currentUserEmail: string | null = null;

  test.beforeEach(async ({ request }) => {
    currentUserEmail = null;
    await cleanupE2EUsers(request);
  });

  test.afterEach(async ({ request }) => {
    // Waffo delivers the success webhook asynchronously. Poll the E2E API
    // for the paid payment row instead of sleeping a fixed interval — if
    // the webhook is late, cleanup would otherwise remove the user first
    // and leave an orphan payment row polluting the local DB.
    if (currentUserEmail) {
      await waitForPaidPayment(request, currentUserEmail, {
        timeoutMs: 30_000,
      });
    }
    await cleanupE2EUsers(request);
  });

  async function completeHostedCheckout(
    page: import('@playwright/test').Page,
    options: {
      paymentButton: string;
      baseURL: string;
    }
  ) {
    const billingUrl = `${options.baseURL.replace(/\/$/, '')}/settings/billing`;
    await page.waitForURL(/https:\/\/.*\.waffo\.(ai|com)\//, {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /Continue/i }).click();
    const cardMethod = page.getByRole('button', {
      name: 'Credit/Debit Card',
    });
    await cardMethod.click();
    const cardNumber = page.locator('input[autocomplete="cc-number"]');
    if (!(await cardNumber.isVisible().catch(() => false))) {
      await page.waitForTimeout(1_000);
      await cardMethod.click();
    }
    await expect(cardNumber).toBeVisible({ timeout: 30_000 });
    await cardNumber.click();
    await cardNumber.pressSequentially('2226900000000110', { delay: 50 });
    const expiry = page.locator('input[autocomplete="cc-exp"]');
    await expiry.click();
    await expiry.pressSequentially('1229', { delay: 50 });
    await expect(expiry).toHaveValue('12/29');
    const cvv = page.locator('input[autocomplete="cc-csc"]');
    await cvv.click();
    await cvv.pressSequentially('123', { delay: 50 });
    const cardholder = page.locator('input[autocomplete="cc-name"]');
    await cardholder.click();
    await cardholder.pressSequentially('TEST USER', { delay: 30 });
    const terms = page.getByRole('checkbox', {
      name: /By clicking Pay/i,
    });
    if (await terms.isVisible().catch(() => false)) {
      await terms.check();
      await expect(terms).toBeChecked();
    }
    const formIsValid = await cardNumber.evaluate(
      (input: HTMLInputElement) => input.form?.checkValidity() ?? false
    );
    expect(formIsValid).toBe(true);
    const payButton = page.getByRole('button', {
      name: options.paymentButton,
      exact: true,
    });
    await expect(payButton).toBeEnabled();
    await payButton.click();
    const doneLink = page.getByRole('link', { name: 'Done', exact: true });
    // Hosted checkouts return with the order-scoped reference, which the
    // payment page polls until the webhook-backed row exists.
    await expect(doneLink).toHaveAttribute(
      'href',
      /\/settings\/payment\?checkout_id=.*callback=/,
      { timeout: 240_000 }
    );
    const returnUrl = await doneLink.getAttribute('href');
    const checkoutReference = new URL(
      returnUrl ?? '',
      options.baseURL
    ).searchParams.get('checkout_id');
    if (!checkoutReference) {
      throw new Error('Waffo return URL is missing checkout_id');
    }
    await doneLink.click();
    await page.waitForURL(billingUrl, {
      timeout: 60_000,
    });
    return checkoutReference;
  }

  test('monthly subscription pays and returns to Billing', async ({
    page,
    request,
    baseURL,
  }) => {
    const user = await registerE2EUser(request);
    currentUserEmail = user.email;
    await loginByForm(page, user);

    await page.goto('/pricing');
    await page.waitForTimeout(1500);

    await page.getByTestId('pricing-card-pro').getByRole('button').click();

    const checkoutReference = await completeHostedCheckout(page, {
      paymentButton: 'Subscribe',
      baseURL: baseURL ?? 'http://localhost:3018',
    });
    const state = await waitForE2EPayment(request, user.email, {
      paidOnly: true,
      predicate: (current) => current.subscription?.interval === 'month',
    });
    expect(state?.latestPayment).toMatchObject({
      interval: 'month',
      paid: true,
      scene: 'subscription',
      status: 'active',
      sessionId: checkoutReference,
    });
  });

  test('yearly subscription pays and returns to Billing', async ({
    page,
    request,
    baseURL,
  }) => {
    const user = await registerE2EUser(request);
    currentUserEmail = user.email;
    await loginByForm(page, user);
    await page.goto('/pricing');
    await page.waitForTimeout(1_500);
    await page.getByTestId('pricing-interval-year').click();
    await page.getByTestId('pricing-card-pro').getByRole('button').click();
    const checkoutReference = await completeHostedCheckout(page, {
      paymentButton: 'Subscribe',
      baseURL: baseURL ?? 'http://localhost:3018',
    });
    const state = await waitForE2EPayment(request, user.email, {
      paidOnly: true,
      predicate: (current) => current.subscription?.interval === 'year',
    });
    expect(state?.latestPayment).toMatchObject({
      interval: 'year',
      paid: true,
      scene: 'subscription',
      status: 'active',
      sessionId: checkoutReference,
    });
  });

  test('lifetime purchase pays and returns to Billing', async ({
    page,
    request,
    baseURL,
  }) => {
    const user = await registerE2EUser(request);
    currentUserEmail = user.email;
    await loginByForm(page, user);
    await page.goto('/pricing');
    await page.getByTestId('pricing-card-lifetime').getByRole('button').click();
    const checkoutReference = await completeHostedCheckout(page, {
      paymentButton: 'Pay',
      baseURL: baseURL ?? 'http://localhost:3018',
    });
    const state = await waitForE2EPayment(request, user.email, {
      paidOnly: true,
      predicate: (current) => current.latestPayment?.scene === 'lifetime',
    });
    expect(state?.latestPayment).toMatchObject({
      paid: true,
      scene: 'lifetime',
      status: 'completed',
      type: 'one_time',
      sessionId: checkoutReference,
    });
  });

  test('payment callback does not duplicate initial subscription state', async ({
    page,
    request,
    baseURL,
  }) => {
    const user = await registerE2EUser(request);
    currentUserEmail = user.email;
    await loginByForm(page, user);

    await page.goto('/pricing');
    await page.waitForTimeout(1_500);

    await page.getByTestId('pricing-card-pro').getByRole('button').click();

    await completeHostedCheckout(page, {
      paymentButton: 'Subscribe',
      baseURL: baseURL ?? 'http://localhost:3018',
    });

    // Waffo also delivers the pure `subscription.payment_succeeded` payment
    // event. It must not overwrite the lifecycle state written by
    // `subscription.activated` or create a duplicate payment row.
    const first = await waitForSubscription(request, user.email, {
      timeoutMs: 30_000,
    });
    expect(first).not.toBeNull();
    expect(first!.paymentCount).toBe(1);
    expect(first!.subscription).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: false,
      interval: 'month',
    });
    expect(first!.subscription!.periodEnd).not.toBeNull();

    // Give a late payment event time to land, then re-verify no regression.
    await page.waitForTimeout(5_000);
    const settled = await waitForSubscription(request, user.email, {
      timeoutMs: 10_000,
    });
    expect(settled).not.toBeNull();
    expect(settled!.paymentCount).toBe(1);
    expect(settled!.subscription?.status).toBe('active');
    expect(settled!.subscription?.cancelAtPeriodEnd).toBe(false);
  });
});
