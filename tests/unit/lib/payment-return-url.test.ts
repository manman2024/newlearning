import {
  getSafePaymentCallback,
  normalizePaymentReturnUrl,
  PAYMENT_RETURN_URL_ERROR,
} from '@/lib/payment-return-url';
import { describe, expect, test } from 'vitest';

const APPLICATION_URL = 'https://app.example.test';

describe('payment return URL security', () => {
  test.each([
    ['/settings/billing', 'https://app.example.test/settings/billing'],
    ['settings/billing', 'https://app.example.test/settings/billing'],
    [
      'https://app.example.test/payment?status=paid#result',
      'https://app.example.test/payment?status=paid#result',
    ],
    [
      'https://app.example.test:443/settings/billing',
      'https://app.example.test/settings/billing',
    ],
  ])('normalizes a same-origin URL: %s', (value, expected) => {
    expect(normalizePaymentReturnUrl(value, APPLICATION_URL)).toBe(expected);
  });

  test.each([
    'https://attacker.example/settings/billing',
    '//attacker.example/settings/billing',
    '\\\\attacker.example/settings/billing',
    '/\\attacker.example/settings/billing',
    '\\/attacker.example/settings/billing',
    'http://app.example.test/settings/billing',
    'https://sub.app.example.test/settings/billing',
    'https://app.example.test:444/settings/billing',
    'javascript:alert(1)',
  ])('rejects a cross-origin or ambiguous URL: %s', (value) => {
    expect(() => normalizePaymentReturnUrl(value, APPLICATION_URL)).toThrow(
      PAYMENT_RETURN_URL_ERROR
    );
  });

  test('keeps encoded slashes as a same-origin path rather than a host', () => {
    expect(
      normalizePaymentReturnUrl('%2F%2Fattacker.example/path', APPLICATION_URL)
    ).toBe('https://app.example.test/%2F%2Fattacker.example/path');
  });

  test('reduces a trusted callback to an internal path', () => {
    expect(
      getSafePaymentCallback(
        'https://app.example.test/settings/billing?paid=true#plan',
        APPLICATION_URL
      )
    ).toBe('/settings/billing?paid=true#plan');
  });

  test.each([
    'https://attacker.example/settings/billing',
    '//attacker.example/settings/billing',
  ])('returns no callback for an unsafe destination: %s', (value) => {
    expect(getSafePaymentCallback(value, APPLICATION_URL)).toBeNull();
  });
});
