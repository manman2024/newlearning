import { createFileRoute } from '@tanstack/react-router';
import {
  getPaymentProviderName,
  handleWebhookEvent,
  isPaymentEnabled,
} from '@/payment';
import { InvalidWebhookSignatureError } from '@/payment/errors';
import { logOperationalEvent } from '@/lib/observability';

type WaffoWebhookDependencies = {
  isPaymentEnabled: () => boolean;
  getPaymentProviderName: () => string;
  handleWebhookEvent: (payload: string, signature: string) => Promise<void>;
};

const waffoWebhookDependencies: WaffoWebhookDependencies = {
  isPaymentEnabled,
  getPaymentProviderName,
  handleWebhookEvent,
};

/**
 * Acknowledge processed work, reject invalid signatures with 400, and return
 * a retryable 500 when database or provider processing fails.
 */
export async function handleWaffoWebhookRequest(
  request: Request,
  dependencies: WaffoWebhookDependencies = waffoWebhookDependencies
): Promise<Response> {
  if (!dependencies.isPaymentEnabled()) {
    return Response.json({ received: true }, { status: 200 });
  }
  // handleWebhookEvent dispatches to the configured provider, so a
  // stale endpoint must not be handed to a different provider's parser.
  if (dependencies.getPaymentProviderName() !== 'waffo') {
    return Response.json(
      { error: 'Waffo is not the active payment provider' },
      { status: 404 }
    );
  }
  const payload = await request.text();
  const signature = request.headers.get('x-waffo-signature') ?? '';
  if (!payload || !signature) {
    logOperationalEvent.warn('Waffo webhook: missing payload or signature');
    return Response.json(
      { error: 'Missing payload or signature' },
      { status: 400 }
    );
  }
  try {
    await dependencies.handleWebhookEvent(payload, signature);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    logOperationalEvent.error('Waffo webhook error:', err);
    if (err instanceof InvalidWebhookSignatureError) {
      return Response.json(
        { error: 'Invalid Waffo signature' },
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
 * Waffo Pancake webhook endpoint.
 * Configure one HTTPS endpoint per Waffo environment and subscribe to:
 * order.completed, subscription.*, refund.succeeded, refund.failed.
 */
export const Route = createFileRoute('/api/webhooks/waffo')({
  server: {
    handlers: {
      POST: ({ request }) => handleWaffoWebhookRequest(request),
    },
  },
});
