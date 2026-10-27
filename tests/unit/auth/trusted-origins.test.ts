import { describe, expect, test } from 'vitest';
import {
  getTrustedExtensionOrigins,
  getTrustedOrigins,
  isTrustedExtensionOrigin,
} from '@/auth/trusted-origins';

const getExtensionOrigins = (value: string) =>
  getTrustedExtensionOrigins(getTrustedOrigins(value));

describe('trusted extension origins', () => {
  test('keeps Chrome extension origins exact', () => {
    const trustedOrigins = getExtensionOrigins(
      'chrome-extension://abcdefghijklmnop, moz-extension://fixed-id'
    );

    expect(
      isTrustedExtensionOrigin(
        'chrome-extension://abcdefghijklmnop',
        trustedOrigins
      )
    ).toBe(true);
    expect(
      isTrustedExtensionOrigin(
        'chrome-extension://different-extension',
        trustedOrigins
      )
    ).toBe(false);
  });

  test('allows Firefox dynamic origins only after an explicit wildcard opt-in', () => {
    const withoutWildcard = getExtensionOrigins('moz-extension://fixed-id');
    const withWildcard = getExtensionOrigins('moz-extension://*');

    expect(
      isTrustedExtensionOrigin(
        'moz-extension://c0ffee00-1234-4567-89ab-0123456789ab',
        withoutWildcard
      )
    ).toBe(false);
    expect(
      isTrustedExtensionOrigin(
        'moz-extension://c0ffee00-1234-4567-89ab-0123456789ab',
        withWildcard
      )
    ).toBe(true);
  });

  test('does not treat a non-extension trusted origin as an extension origin', () => {
    const trustedOrigins = getExtensionOrigins('https://app.example.com');

    expect(
      isTrustedExtensionOrigin('https://app.example.com', trustedOrigins)
    ).toBe(false);
  });
});
