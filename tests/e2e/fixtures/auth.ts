import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_TEST_SECRET, type E2EUser, createE2EUser } from './test-data';

const e2eHeaders = {
  'x-e2e-secret': E2E_TEST_SECRET,
};

export async function cleanupE2EUsers(request: APIRequestContext) {
  const response = await request.delete('/api/e2e/users', {
    headers: e2eHeaders,
  });

  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function registerE2EUser(
  request: APIRequestContext,
  overrides: Partial<E2EUser> = {}
) {
  const user = createE2EUser(overrides);
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const response = await request.post('/api/auth/sign-up/email', {
    headers: {
      Origin: origin,
      Referer: `${origin}/auth/register`,
    },
    data: {
      email: user.email,
      password: user.password,
      name: user.name,
      callbackURL: '/dashboard',
    },
  });

  expect(response.ok(), await response.text()).toBeTruthy();

  await updateE2EUser(request, {
    email: user.email,
    emailVerified: true,
    role: user.role ?? 'user',
  });

  return user;
}

export async function updateE2EUser(
  request: APIRequestContext,
  data: {
    email: string;
    emailVerified?: boolean;
    role?: 'admin' | 'user' | null;
    customerId?: string | null;
  }
) {
  const response = await request.patch('/api/e2e/users', {
    headers: e2eHeaders,
    data,
  });

  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function loginByForm(page: Page, user: E2EUser) {
  await page.goto('/auth/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  const signInButton = page
    .locator('form')
    .filter({ has: page.locator('input[name="email"]') })
    .locator('button[type="submit"]');
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
}

/**
 * Poll until a paid payment row for the given E2E user exists, or the
 * timeout expires. Used by hosted-checkout E2E specs to wait for the
 * asynchronous provider webhook to land before test teardown removes
 * the user.
 */
export async function waitForPaidPayment(
  request: APIRequestContext,
  email: string,
  {
    timeoutMs = 30_000,
    intervalMs = 1_000,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
): Promise<boolean> {
  const state = await waitForE2EPayment(request, email, {
    paidOnly: true,
    timeoutMs,
    intervalMs,
  });
  return (state?.paymentCount ?? 0) > 0;
}

export interface E2EPaymentRow {
  id: string;
  priceId: string;
  subscriptionId: string | null;
  sessionId: string | null;
  invoiceId: string | null;
  type: string;
  scene: string | null;
  status: string;
  paid: boolean;
  interval: string | null;
  periodStart: string | number | null;
  periodEnd: string | number | null;
  cancelAtPeriodEnd: boolean | null;
  trialStart: string | number | null;
  trialEnd: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
}

export interface E2ESubscriptionRow {
  status: string;
  interval: string | null;
  periodStart: string | number | null;
  periodEnd: string | number | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string | number;
  updatedAt: string | number;
  priceId?: string;
  subscriptionId?: string | null;
  sessionId?: string | null;
  invoiceId?: string | null;
  paid?: boolean;
}

export interface E2EPaymentState {
  paymentCount: number;
  latestPayment: E2EPaymentRow | null;
  subscription: E2ESubscriptionRow | null;
}

export async function waitForE2EPayment(
  request: APIRequestContext,
  email: string,
  {
    paidOnly = false,
    timeoutMs = 30_000,
    intervalMs = 1_000,
    predicate,
  }: {
    paidOnly?: boolean;
    timeoutMs?: number;
    intervalMs?: number;
    predicate?: (state: E2EPaymentState) => boolean;
  } = {}
): Promise<E2EPaymentState | null> {
  const deadline = Date.now() + timeoutMs;
  const query = new URLSearchParams({ email });
  if (paidOnly) query.set('paid', 'true');

  while (Date.now() < deadline) {
    const response = await request.get(`/api/e2e/users?${query}`, {
      headers: e2eHeaders,
    });
    if (response.ok()) {
      const body = (await response.json()) as Partial<E2EPaymentState>;
      const state: E2EPaymentState = {
        paymentCount: body.paymentCount ?? 0,
        latestPayment: body.latestPayment ?? null,
        subscription: body.subscription ?? null,
      };
      const hasPayment = paidOnly
        ? state.paymentCount > 0
        : state.latestPayment !== null;
      if (hasPayment && (!predicate || predicate(state))) return state;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

/**
 * Poll until a paid payment row for the given E2E user exists, returning the
 * payment count and the latest subscription row exposed by the E2E API.
 * Used by the Waffo renewal journey to assert webhook lifecycle state.
 */
export async function waitForSubscription(
  request: APIRequestContext,
  email: string,
  {
    timeoutMs = 30_000,
    intervalMs = 1_000,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
): Promise<{
  paymentCount: number;
  subscription: E2ESubscriptionRow | null;
} | null> {
  const state = await waitForE2EPayment(request, email, {
    paidOnly: true,
    timeoutMs,
    intervalMs,
  });
  if (!state) return null;
  return {
    paymentCount: state.paymentCount,
    subscription: state.subscription,
  };
}
