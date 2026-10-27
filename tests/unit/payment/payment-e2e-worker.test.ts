import { describe, expect, it } from 'vitest';
import { getPaymentE2EWorkerVars } from '../../../scripts/payment-e2e-worker';

describe('payment E2E Worker environment', () => {
  const env = {
    PLAYWRIGHT_BASE_URL: 'http://localhost:3018',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_listener',
    CREEM_API_KEY: 'creem_test_example',
    CREEM_WEBHOOK_SECRET: 'creem_webhook',
    WAFFO_MERCHANT_ID: 'merchant_test',
    WAFFO_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nexample\n',
    CLOUDFLARE_API_TOKEN: 'must-not-enter-worker',
    BETTER_AUTH_SECRET: 'production-secret',
  };

  it('uses the listener secret and excludes other provider and host secrets', () => {
    const vars = getPaymentE2EWorkerVars({
      ...env,
      PAYMENT_E2E_PROVIDER: 'stripe',
    });
    expect(vars.STRIPE_WEBHOOK_SECRET).toBe('whsec_listener');
    expect(vars).not.toHaveProperty('CREEM_API_KEY');
    expect(vars).not.toHaveProperty('WAFFO_PRIVATE_KEY');
    expect(vars).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
    expect(vars.BETTER_AUTH_SECRET).not.toBe(env.BETTER_AUTH_SECRET);
  });

  it('enables Creem sandbox mode and preserves multiline Waffo keys', () => {
    expect(
      getPaymentE2EWorkerVars({ ...env, PAYMENT_E2E_PROVIDER: 'creem' })
        .CREEM_DEBUG
    ).toBe('true');
    const vars = getPaymentE2EWorkerVars({
      ...env,
      PAYMENT_E2E_PROVIDER: 'waffo',
    });
    expect(vars.WAFFO_PRIVATE_KEY).toBe(env.WAFFO_PRIVATE_KEY);
    expect(vars).not.toHaveProperty('STRIPE_SECRET_KEY');
  });

  it('rejects missing credentials without including secret values in errors', () => {
    expect(() =>
      getPaymentE2EWorkerVars({
        ...env,
        PAYMENT_E2E_PROVIDER: 'waffo',
        WAFFO_PRIVATE_KEY: '',
      })
    ).toThrow('WAFFO_PRIVATE_KEY is required');
    expect(() => getPaymentE2EWorkerVars(env)).toThrow(
      'Start payment E2E through pnpm e2e:<provider>'
    );
  });
});
