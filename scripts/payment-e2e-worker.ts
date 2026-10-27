type RuntimeEnv = Record<string, string | undefined>;

const PROVIDER_KEYS = {
  stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  creem: ['CREEM_API_KEY', 'CREEM_WEBHOOK_SECRET'],
  waffo: ['WAFFO_MERCHANT_ID', 'WAFFO_PRIVATE_KEY'],
} as const;

export type PaymentE2EProvider = keyof typeof PROVIDER_KEYS;

/** Only test credentials enter the Worker; never copy the entire process env. */
export function getPaymentE2EWorkerVars(env: RuntimeEnv) {
  const provider = env.PAYMENT_E2E_PROVIDER;
  if (provider !== 'stripe' && provider !== 'creem' && provider !== 'waffo') {
    throw new Error('Start payment E2E through pnpm e2e:<provider>');
  }

  const vars: Record<string, string> = {
    VITE_BASE_URL: env.PLAYWRIGHT_BASE_URL ?? '',
    BETTER_AUTH_SECRET: 'e2e-better-auth-secret-at-least-32-characters',
  };
  if (!vars.VITE_BASE_URL) {
    throw new Error('PLAYWRIGHT_BASE_URL is required for payment E2E');
  }
  for (const key of PROVIDER_KEYS[provider]) {
    const value = env[key];
    if (!value) throw new Error(`${key} is required for payment E2E Worker`);
    vars[key] = value;
  }
  if (provider === 'creem') vars.CREEM_DEBUG = 'true';
  return vars;
}
