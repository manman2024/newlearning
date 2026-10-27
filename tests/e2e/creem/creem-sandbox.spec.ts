import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { Creem } from 'creem';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  waitForE2EPayment,
  waitForPaidPayment,
} from '../fixtures/auth';
import type { E2EUser } from '../fixtures/test-data';

const creemApiKey = process.env.CREEM_API_KEY;
if (!creemApiKey || process.env.CREEM_DEBUG !== 'true') {
  throw new Error(
    'Creem sandbox tests require CREEM_DEBUG=true and a test-mode API key'
  );
}

const creem = new Creem({ apiKey: creemApiKey, serverIdx: 1 });

type CheckoutScenario = {
  planId: 'lifetime' | 'pro';
  expectedProductId: string;
  interval?: 'month' | 'year';
  cardNumber?: string;
};

const testAddress = {
  country: 'United States',
  state: 'California',
  address: '123 Market Street',
  city: 'San Francisco',
  postalCode: '94105',
};

function productId(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Creem sandbox E2E`);
  return value;
}

async function selectCreemOption(
  page: Page,
  combobox: Locator,
  option: string
) {
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function fillCreemBuyerDetails(page: Page, user: E2EUser) {
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(
    user.email
  );
  await page.getByRole('textbox', { name: 'Full name' }).fill(user.name);

  const country = page.getByRole('combobox').nth(0);
  await selectCreemOption(page, country, testAddress.country);

  await page
    .getByRole('textbox', { name: 'Address line 1' })
    .fill(testAddress.address);
  const state = page.getByRole('combobox').nth(1);
  await selectCreemOption(page, state, testAddress.state);
  await page.getByRole('textbox', { name: 'City' }).fill(testAddress.city);
  await page
    .getByRole('textbox', { name: 'Postal Code' })
    .fill(testAddress.postalCode);
}

async function findCreemPaymentField(
  page: Page,
  selectors: string[],
  accessibleName: RegExp,
  description: string
) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const field = frame.locator(selector).first();
        if (await field.isVisible().catch(() => false)) return field;
      }

      const field = frame
        .getByRole('textbox', { name: accessibleName })
        .first();
      if (await field.isVisible().catch(() => false)) return field;
    }

    await page.waitForTimeout(250);
  }

  const initializationError = page.getByText(/payment system not initialized/i);
  if (await initializationError.isVisible().catch(() => false)) {
    throw new Error(
      `Creem hosted checkout payment form did not initialize while looking for ${description}`
    );
  }
  throw new Error(`Creem hosted checkout field not found: ${description}`);
}

async function fillCreemCard(page: Page, cardNumber: string) {
  const cardholder = page
    .locator('input[name="cardHolderName"], input[autocomplete="cc-name"]')
    .first();
  await expect(cardholder).toBeVisible({ timeout: 45_000 });

  const cardNumberField = await findCreemPaymentField(
    page,
    [
      'input[autocomplete="cc-number"]',
      'input[name="cardnumber"]',
      'input[name="cardNumber"]',
      'input[data-elements-stable-field-name="cardNumber"]',
    ],
    /card number/i,
    'card number'
  );
  await cardNumberField.fill(cardNumber);

  const expiryField = await findCreemPaymentField(
    page,
    [
      'input[autocomplete="cc-exp"]',
      'input[name="exp-date"]',
      'input[name="cardExpiry"]',
      'input[data-elements-stable-field-name="cardExpiry"]',
    ],
    /expiration|expiry/i,
    'card expiry'
  );
  await expiryField.fill('1230');

  const cvcField = await findCreemPaymentField(
    page,
    [
      'input[autocomplete="cc-csc"]',
      'input[name="cvc"]',
      'input[name="cardCvc"]',
      'input[data-elements-stable-field-name="cardCvc"]',
    ],
    /security code|cvc/i,
    'card security code'
  );
  await cvcField.fill('');
  await cvcField.pressSequentially('123', { delay: 50 });
  await expect(cvcField).toHaveValue('123');

  // Creem can remount the cardholder field while its payment iframe
  // initializes. Its validation also rejects generated account names that
  // contain digits, so use a stable alphabetic sandbox cardholder name.
  await cardholder.click();
  await cardholder.pressSequentially('Sandbox User', { delay: 50 });
  await expect(cardholder).toHaveValue('Sandbox User');
}

async function startCreemCheckout(
  page: Page,
  user: E2EUser,
  scenario: CheckoutScenario
) {
  await loginByForm(page, user);
  await page.goto('/pricing');
  await page.waitForLoadState('networkidle');

  if (scenario.interval === 'year') {
    await page.getByTestId('pricing-interval-year').click();
  }

  const planCard = page.getByTestId(`pricing-card-${scenario.planId}`);
  await planCard.getByRole('button').click();

  await page.waitForURL(/https:\/\/(?:www\.)?creem\.io\//, {
    timeout: 60_000,
  });
  await expect(
    page.getByRole('button', { name: 'Continue to payment', exact: true })
  ).toBeVisible({ timeout: 60_000 });

  await fillCreemBuyerDetails(page, user);
  await page
    .getByRole('button', { name: 'Continue to payment', exact: true })
    .click();

  const payButton = page
    .locator('button[type="submit"]')
    .filter({ hasText: /^Pay\b/i })
    .first();
  await expect(payButton).toBeVisible({ timeout: 60_000 });
  await fillCreemCard(page, scenario.cardNumber ?? '4242424242424242');
  await expect(payButton).toBeEnabled();
  return payButton;
}

async function completeCreemCheckout(
  page: Page,
  user: E2EUser,
  scenario: CheckoutScenario
) {
  const payButton = await startCreemCheckout(page, user, scenario);
  await payButton.click();

  // Creem rewrites the success URL query and returns the checkout request ID.
  // The provider sets it to the same order-scoped reference copied into
  // payment.sessionId by the webhook.
  await page.waitForURL(/\/settings\/payment\?.*request_id=/, {
    timeout: 120_000,
  });
  const checkoutReference = new URL(page.url()).searchParams.get('request_id');
  if (!checkoutReference) {
    throw new Error('Creem return URL is missing request_id');
  }
  await page.waitForURL(/\/settings\/billing\/?$/, { timeout: 120_000 });
  return checkoutReference;
}

async function waitForCreemPayment(
  request: APIRequestContext,
  email: string,
  scenario: CheckoutScenario
) {
  const state = await waitForE2EPayment(request, email, {
    paidOnly: true,
    timeoutMs: 60_000,
    predicate: (current) =>
      current.latestPayment?.paid === true &&
      current.latestPayment?.priceId === scenario.expectedProductId,
  });
  if (!state?.latestPayment) {
    throw new Error(`No paid Creem payment row found for ${email}`);
  }
  expect(state.paymentCount).toBe(1);
  expect(state.latestPayment).toMatchObject({
    paid: true,
    priceId: scenario.expectedProductId,
    status: scenario.interval ? 'active' : 'completed',
  });
  return state;
}

test.describe
  .serial('Creem sandbox payment flows', () => {
    let currentUserEmail: string | null = null;
    let paymentExpected = false;

    test.beforeAll(async ({ request }) => {
      await cleanupE2EUsers(request);
    });

    test.beforeEach(async () => {
      currentUserEmail = null;
      paymentExpected = false;
    });

    test.afterEach(async ({ request }) => {
      if (currentUserEmail && paymentExpected) {
        // Creem webhooks are asynchronous. Wait before deleting the local user
        // or a late delivery could create an orphan payment row.
        await waitForPaidPayment(request, currentUserEmail, {
          timeoutMs: 60_000,
        });
      }
      await cleanupE2EUsers(request);
    });

    test('completes a monthly subscription and returns to Billing', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-creem-month-${Date.now()}@example.test`,
      });
      currentUserEmail = user.email;
      paymentExpected = true;

      const scenario = {
        planId: 'pro' as const,
        expectedProductId: productId('VITE_CREEM_PRODUCT_PRO_MONTHLY'),
        interval: 'month' as const,
      };
      const checkoutReference = await completeCreemCheckout(
        page,
        user,
        scenario
      );
      const state = await waitForCreemPayment(request, user.email, scenario);
      expect(state.latestPayment?.sessionId).toBe(checkoutReference);
      expect(state.subscription).toMatchObject({
        status: 'active',
        interval: 'month',
        cancelAtPeriodEnd: false,
      });
      expect(state.subscription?.periodEnd).not.toBeNull();
    });

    test('completes a yearly subscription and records the yearly product', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-creem-year-${Date.now()}@example.test`,
      });
      currentUserEmail = user.email;
      paymentExpected = true;

      const scenario = {
        planId: 'pro' as const,
        expectedProductId: productId('VITE_CREEM_PRODUCT_PRO_YEARLY'),
        interval: 'year' as const,
      };
      const checkoutReference = await completeCreemCheckout(
        page,
        user,
        scenario
      );
      const state = await waitForCreemPayment(request, user.email, scenario);
      expect(state.latestPayment?.sessionId).toBe(checkoutReference);
      expect(state.subscription).toMatchObject({
        status: 'active',
        interval: 'year',
        cancelAtPeriodEnd: false,
      });
    });

    test('completes a Lifetime payment and records a one-time purchase', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-creem-lifetime-${Date.now()}@example.test`,
      });
      currentUserEmail = user.email;
      paymentExpected = true;

      const scenario = {
        planId: 'lifetime' as const,
        expectedProductId: productId('VITE_CREEM_PRODUCT_LIFETIME'),
      };
      const checkoutReference = await completeCreemCheckout(
        page,
        user,
        scenario
      );
      const state = await waitForCreemPayment(request, user.email, scenario);
      expect(state.latestPayment).toMatchObject({
        paid: true,
        scene: 'lifetime',
        status: 'completed',
        type: 'one_time',
        interval: null,
      });
      expect(state.latestPayment?.sessionId).toBe(checkoutReference);
    });

    test('rejects the Creem declined test card without a paid payment row', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-creem-declined-${Date.now()}@example.test`,
      });
      currentUserEmail = user.email;

      const payButton = await startCreemCheckout(page, user, {
        planId: 'pro',
        expectedProductId: productId('VITE_CREEM_PRODUCT_PRO_MONTHLY'),
        interval: 'month',
        cardNumber: '4000000000000002',
      });
      await payButton.click();

      const state = await waitForE2EPayment(request, user.email, {
        timeoutMs: 10_000,
      });
      expect(state?.paymentCount ?? 0).toBe(0);
    });

    test('persists scheduled subscription cancellation from the Creem API', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request, {
        email: `e2e-creem-cancel-${Date.now()}@example.test`,
      });
      currentUserEmail = user.email;
      paymentExpected = true;

      const scenario = {
        planId: 'pro' as const,
        expectedProductId: productId('VITE_CREEM_PRODUCT_PRO_MONTHLY'),
        interval: 'month' as const,
      };
      await completeCreemCheckout(page, user, scenario);
      const paid = await waitForCreemPayment(request, user.email, scenario);
      const subscriptionId = paid.subscription?.subscriptionId;
      if (!subscriptionId) {
        throw new Error(
          'Creem subscription id was not returned in the E2E API'
        );
      }

      await creem.subscriptions.cancel(subscriptionId, { mode: 'scheduled' });
      const scheduled = await waitForE2EPayment(request, user.email, {
        paidOnly: true,
        timeoutMs: 60_000,
        predicate: (state) => state.subscription?.cancelAtPeriodEnd === true,
      });
      expect(scheduled?.subscription).toMatchObject({
        status: 'active',
        cancelAtPeriodEnd: true,
      });
    });
  });
