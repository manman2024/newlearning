import { APIError } from 'better-auth/api';
import { logOperationalEvent } from '@/lib/observability';
import type { SendEmailResult, SendTemplateParams } from '@/mail/types';

const MAX_SEND_ATTEMPTS = 3;

type AuthEmailParams = SendTemplateParams & {
  template: 'verifyEmail' | 'forgotPassword';
};

/** Try up to three times with the same link; never log recipients, links or provider errors. */
export async function sendAuthEmail(
  params: AuthEmailParams,
  send: (params: SendTemplateParams) => Promise<SendEmailResult>
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    let success = false;
    try {
      success = (await send(params)).success;
    } catch {
      // A sender may throw instead of returning a failure result.
    }
    if (success) {
      logOperationalEvent.info('auth.mail.accepted', {
        template: params.template,
        attempt,
      });
      return;
    }
    logOperationalEvent.warn('auth.mail.attempt_failed', {
      template: params.template,
      attempt,
    });
    if (attempt < MAX_SEND_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  logOperationalEvent.error('auth.mail.delivery_failed', {
    template: params.template,
    attempts: MAX_SEND_ATTEMPTS,
  });
  // Reset responses must not reveal whether an account exists, even if the
  // library changes its background error handling in a future release.
  if (params.template === 'verifyEmail') {
    throw new APIError('SERVICE_UNAVAILABLE', {
      code: 'AUTH_EMAIL_SEND_FAILED',
      message: 'Unable to send verification email. Please try again later.',
    });
  }
}
