import { createFileRoute } from '@tanstack/react-router';
import {
  getPaymentProviderName,
  handleWebhookEvent,
  isPaymentEnabled,
} from '@/payment';
import { InvalidWebhookSignatureError } from '@/payment/errors';
import { logOperationalEvent } from '@/lib/observability';

type StripeWebhookDependencies = {
  isPaymentEnabled: () => boolean;
  getPaymentProviderName: () => string;
  handleWebhookEvent: (payload: string, signature: string) => Promise<void>;
};

const stripeWebhookDependencies: StripeWebhookDependencies = {
  isPaymentEnabled,
  getPaymentProviderName,
  handleWebhookEvent,
};

/**
 * Acknowledge valid completed work, reject invalid signatures, and return a
 * retryable 500 when Stripe API or database processing fails.
 */
export async function handleStripeWebhookRequest(
  request: Request,
  dependencies: StripeWebhookDependencies = stripeWebhookDependencies
): Promise<Response> {
  if (!dependencies.isPaymentEnabled()) {
    return Response.json({ received: true }, { status: 200 });
  }
  // A stale endpoint must not be handed to a different provider's parser.
  if (dependencies.getPaymentProviderName() !== 'stripe') {
    return Response.json(
      { error: 'Stripe is not the active payment provider' },
      { status: 404 }
    );
  }
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';
  if (!payload || !signature) {
    logOperationalEvent.warn('Stripe webhook: missing payload or signature');
    return Response.json(
      { error: 'Missing payload or signature' },
      { status: 400 }
    );
  }
  try {
    await dependencies.handleWebhookEvent(payload, signature);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    logOperationalEvent.error('Stripe webhook error:', err);
    if (err instanceof InvalidWebhookSignatureError) {
      return Response.json(
        { error: 'Invalid Stripe signature' },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

/**
 * Stripe webhook endpoint
 * Configure in Stripe Dashboard: Webhooks -> Add endpoint
 * Endpoint URL: https://your-domain.com/api/webhooks/stripe
 * Events: checkout.session.completed, customer.subscription.*, invoice.paid,
 * charge.refunded
 */
export const Route = createFileRoute('/api/webhooks/stripe')({
  server: {
    handlers: {
      POST: ({ request }) => handleStripeWebhookRequest(request),
    },
  },
});
