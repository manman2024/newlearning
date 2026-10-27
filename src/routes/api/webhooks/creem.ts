import { createFileRoute } from '@tanstack/react-router';
import {
  getPaymentProviderName,
  handleWebhookEvent,
  isPaymentEnabled,
} from '@/payment';
import { InvalidWebhookSignatureError } from '@/payment/errors';
import { logOperationalEvent } from '@/lib/observability';

type CreemWebhookDependencies = {
  isPaymentEnabled: () => boolean;
  getPaymentProviderName: () => string;
  handleWebhookEvent: (payload: string, signature: string) => Promise<void>;
};

const creemWebhookDependencies: CreemWebhookDependencies = {
  isPaymentEnabled,
  getPaymentProviderName,
  handleWebhookEvent,
};

/**
 * Acknowledge processed work, reject invalid signatures with 400, and return
 * a retryable 500 when database or provider processing fails.
 */
export async function handleCreemWebhookRequest(
  request: Request,
  dependencies: CreemWebhookDependencies = creemWebhookDependencies
): Promise<Response> {
  if (!dependencies.isPaymentEnabled()) {
    return Response.json({ received: true }, { status: 200 });
  }
  // handleWebhookEvent dispatches to the configured provider, so a
  // stale endpoint must not be handed to a different provider's parser.
  if (dependencies.getPaymentProviderName() !== 'creem') {
    return Response.json(
      { error: 'Creem is not the active payment provider' },
      { status: 404 }
    );
  }
  const payload = await request.text();
  const signature = request.headers.get('creem-signature') ?? '';
  if (!payload || !signature) {
    logOperationalEvent.warn('Creem webhook: missing payload or signature');
    return Response.json(
      { error: 'Missing payload or signature' },
      { status: 400 }
    );
  }
  try {
    await dependencies.handleWebhookEvent(payload, signature);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    logOperationalEvent.error('Creem webhook error:', err);
    if (err instanceof InvalidWebhookSignatureError) {
      return Response.json(
        { error: 'Invalid Creem signature' },
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
 * Creem webhook endpoint
 * Configure in Creem Dashboard: Settings -> Webhooks -> Add endpoint
 * Endpoint URL: https://your-domain.com/api/webhooks/creem
 * Events: checkout.completed, subscription.active, subscription.paid,
 *         subscription.update, subscription.trialing,
 *         subscription.scheduled_cancel, subscription.canceled,
 *         subscription.expired, subscription.past_due, subscription.unpaid,
 *         subscription.paused
 */
export const Route = createFileRoute('/api/webhooks/creem')({
  server: {
    handlers: {
      POST: ({ request }) => handleCreemWebhookRequest(request),
    },
  },
});
