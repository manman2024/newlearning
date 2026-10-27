import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  updateE2EUser,
} from '../fixtures/auth';
import { createE2EUser, E2E_TEST_SECRET } from '../fixtures/test-data';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

async function readUser(request: APIRequestContext, email: string) {
  const response = await request.get('/api/e2e/users', {
    headers: { 'x-e2e-secret': E2E_TEST_SECRET },
    params: { email },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return body.user as {
    id: string;
    name: string;
    customerId: string | null;
  } | null;
}

test.describe('provider-owned customer IDs', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('rejects customer ID injection on signup and allows ordinary signup', async ({
    request,
  }) => {
    const user = createE2EUser();
    const response = await request.post('/api/auth/sign-up/email', {
      headers: { Origin: origin },
      data: { ...user, customerId: 'cus_other_test' },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
    expect(await readUser(request, user.email)).toBeNull();

    await registerE2EUser(request, user);
    expect(await readUser(request, user.email)).toMatchObject({
      name: user.name,
      customerId: null,
    });
  });

  for (const transport of ['cookie', 'bearer'] as const) {
    test(`rejects customer ID replacement through ${transport} authentication`, async ({
      page,
      request,
      playwright,
    }) => {
      const owner = await registerE2EUser(request);
      const other = await registerE2EUser(request);
      await updateE2EUser(request, {
        email: owner.email,
        customerId: 'cus_owner_test',
      });
      await updateE2EUser(request, {
        email: other.email,
        customerId: 'cus_other_test',
      });

      // Keep bearer requests independent of the browser's session cookies.
      const bearerRequest = await playwright.request.newContext({
        baseURL: origin,
      });
      try {
        const headers: Record<string, string> = { Origin: origin };
        if (transport === 'cookie') {
          await loginByForm(page, owner);
        } else {
          const signIn = await request.post('/api/auth/sign-in/email', {
            headers,
            data: { email: owner.email, password: owner.password },
          });
          expect(signIn.ok(), await signIn.text()).toBeTruthy();
          const { token } = await signIn.json();
          expect(typeof token).toBe('string');
          headers.Authorization = `Bearer ${token}`;
        }

        const authenticated =
          transport === 'cookie' ? page.request : bearerRequest;
        const rejected = await authenticated.post('/api/auth/update-user', {
          headers,
          data: { name: 'Injected name', customerId: 'cus_other_test' },
        });
        expect(rejected.status()).toBe(400);
        expect(await rejected.json()).toMatchObject({
          code: 'FIELD_NOT_ALLOWED',
        });
        expect(await readUser(request, owner.email)).toMatchObject({
          name: owner.name,
          customerId: 'cus_owner_test',
        });
        expect(await readUser(request, other.email)).toMatchObject({
          name: other.name,
          customerId: 'cus_other_test',
        });
      } finally {
        await bearerRequest.dispose();
      }
    });
  }

  test('discards empty customer IDs while preserving legitimate profile updates', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await updateE2EUser(request, {
      email: user.email,
      customerId: 'cus_owner_test',
    });
    await loginByForm(page, user);

    for (const [label, customerId] of [
      ['empty', ''],
      ['null', null],
    ] as const) {
      const name = `E2E profile ${label}`;
      const response = await page.request.post('/api/auth/update-user', {
        headers: { Origin: origin },
        data: { name, customerId },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      expect(await readUser(request, user.email)).toMatchObject({
        name,
        customerId: 'cus_owner_test',
      });
    }

    await page.goto('/settings/profile');
    await expect(page.locator('input[name="name"]')).toHaveValue(
      'E2E profile null'
    );
  });
});
