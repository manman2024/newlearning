import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';
import { sendAuthEmail } from '@/auth/send-auth-email';
import type { SendTemplateParams } from '@/mail/types';

function setup() {
  const sender = vi.fn().mockResolvedValue({ success: true });
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'local-auth-mail-test-secret-long-enough',
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: ({ user, url }) =>
        sendAuthEmail(
          { to: user.email, template: 'forgotPassword', context: { url } },
          sender
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: ({ user, url }) =>
        sendAuthEmail(
          { to: user.email, template: 'verifyEmail', context: { url } },
          sender
        ),
    },
  });
  const post = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify(body),
      })
    );
  const account = {
    email: 'e2e-mail@example.test',
    name: 'Mail Test',
    password: 'test-password-123',
  };
  return { sender, post, account, handler: auth.handler };
}

describe('auth mail through installed auth endpoints', () => {
  it('registers without a session and recovers a transient send failures with the same link', async () => {
    const { sender, post, account } = setup();
    sender
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    const response = await post('sign-up/email', account);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[0][0]).toEqual(sender.mock.calls[1][0]);
    expect(sender.mock.calls[0][0]).toEqual(sender.mock.calls[2][0]);
  });

  it('surfaces persistent resend failure, allows recovery and preserves password/session boundaries', async () => {
    const { sender, post, account } = setup();
    await post('sign-up/email', account);
    sender.mockClear().mockResolvedValue({ success: false });
    const resend = await post('send-verification-email', {
      email: account.email,
    });
    expect(resend.status).toBe(503);
    expect(await resend.json()).toMatchObject({
      code: 'AUTH_EMAIL_SEND_FAILED',
    });
    expect(sender).toHaveBeenCalledTimes(3);
    sender.mockClear();
    const wrong = await post('sign-in/email', {
      ...account,
      password: 'wrong-password',
    });
    expect(wrong.status).toBe(401);
    expect(sender).not.toHaveBeenCalled();
    const unverified = await post('sign-in/email', account);
    expect(unverified.status).toBe(403);
    expect(unverified.headers.get('set-cookie')).toBeNull();
    sender.mockResolvedValue({ success: true });
    expect(
      (await post('send-verification-email', { email: account.email })).status
    ).toBe(200);
  });

  it('keeps password-reset responses uniform across delivery failure and missing accounts', async () => {
    const { sender, post, account } = setup();
    await post('sign-up/email', account);
    sender.mockClear().mockRejectedValue(new Error('private-provider-detail'));
    const failed = await post('request-password-reset', {
      email: account.email,
    });
    expect(sender).toHaveBeenCalledTimes(3);
    sender.mockClear();
    const missing = await post('request-password-reset', {
      email: 'e2e-missing@example.test',
    });
    expect(sender).not.toHaveBeenCalled();
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual(await missing.json());
    expect(failed.headers.get('set-cookie')).toBeNull();
  });

  it('retains an unverified account after persistent signup failure and accepts a later verification link', async () => {
    const { sender, post, account, handler } = setup();
    sender.mockResolvedValue({ success: false });
    const registered = await post('sign-up/email', account);
    expect(registered.status).toBe(200);
    expect(registered.headers.get('set-cookie')).toBeNull();
    expect(sender).toHaveBeenCalledTimes(3);
    sender.mockResolvedValue({ success: true });
    await post('send-verification-email', { email: account.email });
    const link = sender.mock.calls.at(-1)?.[0].context.url as string;
    const token = new URL(link).searchParams.get('token');
    expect(token).toBeTruthy();
    // Exercise the real verify endpoint through its token, rather than editing DB state.
    const verified = await handler(new Request(link));
    expect(verified.status).toBe(302);
    const login = await post('sign-in/email', account);
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('session_token');
  });

  it('logs bounded failure metadata without recipient, token or raw error', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const params: SendTemplateParams = {
      to: 'private@example.test',
      template: 'forgotPassword',
      context: { url: 'secret-token' },
    };
    await sendAuthEmail(
      { ...params, template: 'forgotPassword' },
      vi.fn().mockRejectedValue(new Error('private-error'))
    );
    expect(errorLog).toHaveBeenCalledWith(
      '[auth.mail.delivery_failed] {"template":"forgotPassword","attempts":3}'
    );
    expect(
      JSON.stringify([...errorLog.mock.calls, ...warningLog.mock.calls])
    ).not.toMatch(/private|secret-token/);
    errorLog.mockRestore();
    warningLog.mockRestore();
  });
});
