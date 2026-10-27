import { expect, test } from '@playwright/test';
import {
  expectHealthyPage,
  installPageHealthMonitor,
  localizedPath,
  type LocaleMode,
} from '../fixtures/page-health';

const publicPages = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/blog', name: 'blog index' },
  { path: '/blog/getting-started', name: 'blog detail' },
  { path: '/ai', name: 'ai playground' },
  { path: '/about', name: 'about' },
  { path: '/contact', name: 'contact' },
  { path: '/changelog', name: 'changelog' },
  { path: '/roadmap', name: 'roadmap' },
  { path: '/waitlist', name: 'waitlist' },
  { path: '/cookie', name: 'cookie policy' },
  { path: '/privacy', name: 'privacy policy' },
  { path: '/terms', name: 'terms of service' },
  { path: '/auth/login', name: 'login' },
  { path: '/auth/register', name: 'register' },
  { path: '/auth/forgot-password', name: 'forgot password' },
  { path: '/auth/reset-password', name: 'reset password' },
] as const;

const locales: LocaleMode[] = ['en', 'zh'];

test.describe('public page smoke coverage', () => {
  for (const locale of locales) {
    test(`renders all public pages in ${locale}`, async ({ page }) => {
      const monitor = installPageHealthMonitor(page);

      for (const publicPage of publicPages) {
        await test.step(publicPage.name, async () => {
          await expectHealthyPage(
            page,
            monitor,
            localizedPath(publicPage.path, locale)
          );
        });
      }
    });
  }

  test('opens the home page login modal', async ({ page }) => {
    const monitor = installPageHealthMonitor(page);

    await expectHealthyPage(page, monitor, '/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('navbar-login-trigger').click();

    const dialog = page.getByTestId('auth-login-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[name="email"]')).toBeVisible();
    await expect(dialog.locator('input[name="password"]')).toBeVisible();
    monitor.expectNoErrors('home login modal');
  });

  test('renders mobile auth actions without nested buttons', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const nestedButtonErrors: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().includes('cannot be a descendant')
      ) {
        nestedButtonErrors.push(message.text());
      }
    });

    await page.goto('/');
    await page.getByTestId('mobile-nav-toggle').click();

    const mobileNavigation = page.getByTestId('mobile-navigation');
    await expect(mobileNavigation).toBeVisible();
    await expect(
      mobileNavigation.getByTestId('mobile-nav-login-trigger')
    ).toBeVisible();
    await expect(
      mobileNavigation.getByTestId('mobile-nav-signup-link')
    ).toHaveAttribute('href', '/auth/register');
    expect(nestedButtonErrors).toEqual([]);

    await mobileNavigation.getByTestId('mobile-nav-login-trigger').click();
    await expect(page).toHaveURL(/\/auth\/login\/?$/);
  });

  test('health check responds with pong', async ({ request }) => {
    const response = await request.get('/api/ping');

    await expect(response).toBeOK();
    expect(await response.json()).toEqual({ message: 'pong' });
  });
});

test('localized content metadata and sitemap agree', async ({
  page,
  request,
}) => {
  for (const path of ['/terms', '/blog/getting-started']) {
    for (const locale of locales) {
      const localized = localizedPath(path, locale);
      await page.goto(localized);
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveAttribute(
        'href',
        new RegExp(`${localized}$`)
      );
      const alternates = page.locator('link[rel="alternate"][hreflang]');
      await expect(alternates).toHaveCount(3);
    }
  }

  const origin = new URL(page.url()).origin;
  const response = await request.get('/sitemap.xml');
  expect(response.ok()).toBe(true);
  const xml = await response.text();
  for (const path of [
    '/terms',
    '/zh/terms',
    '/blog/getting-started',
    '/zh/blog/getting-started',
  ]) {
    expect(xml).toContain(`<loc>${origin}${path}</loc>`);
  }
});
