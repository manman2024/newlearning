export class InvalidWebhookSignatureError extends Error {
  override name = 'InvalidWebhookSignatureError';

  constructor(provider = 'Stripe') {
    super(`Invalid ${provider} webhook signature`);
  }
}
