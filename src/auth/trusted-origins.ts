const FIREFOX_EXTENSION_ORIGIN_WILDCARD = 'moz-extension://*';

export const getTrustedOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const getTrustedExtensionOrigins = (
  trustedOrigins: readonly string[]
): string[] =>
  trustedOrigins.filter(
    (origin) =>
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('moz-extension://')
  );

/**
 * Chrome extension IDs are stable, so they always require an exact allowlist
 * entry. Firefox assigns each installed extension a profile-specific UUID;
 * `moz-extension://*` is the explicit opt-in for that browser's dynamic origin.
 */
export const isTrustedExtensionOrigin = (
  origin: string | null,
  trustedExtensionOrigins: readonly string[]
): origin is string =>
  origin !== null &&
  (trustedExtensionOrigins.includes(origin) ||
    (origin.startsWith('moz-extension://') &&
      trustedExtensionOrigins.includes(FIREFOX_EXTENSION_ORIGIN_WILDCARD)));
