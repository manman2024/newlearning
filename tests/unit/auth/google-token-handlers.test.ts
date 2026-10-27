import { describe, expect, test, vi } from 'vitest';
import { createGoogleTokenHandlers } from '@/auth/google-token-handlers';

const createHandlers = () => {
  const verifyGoogleIdToken = vi.fn();
  const verifyExtensionAccessToken = vi.fn();
  const getDefaultUserInfo = vi.fn();
  const getExtensionUserInfo = vi.fn();

  return {
    handlers: createGoogleTokenHandlers({
      audiences: ['web-client-id', 'extension-client-id'],
      verifyGoogleIdToken,
      verifyExtensionAccessToken,
      getDefaultUserInfo,
      getExtensionUserInfo,
    }),
    verifyGoogleIdToken,
    verifyExtensionAccessToken,
    getDefaultUserInfo,
    getExtensionUserInfo,
  };
};

describe('Google token handlers', () => {
  test('uses Better Auth ID-token verification for JWTs', async () => {
    const { handlers, verifyGoogleIdToken, verifyExtensionAccessToken } =
      createHandlers();
    verifyGoogleIdToken.mockResolvedValue({ sub: 'user-id' });

    await expect(
      handlers.verifyIdToken('header.payload.signature', 'nonce')
    ).resolves.toBe(true);

    expect(verifyGoogleIdToken).toHaveBeenCalledWith({
      token: 'header.payload.signature',
      audience: ['web-client-id', 'extension-client-id'],
      nonce: 'nonce',
    });
    expect(verifyExtensionAccessToken).not.toHaveBeenCalled();
  });

  test('uses the extension verifier only for opaque access tokens', async () => {
    const { handlers, verifyGoogleIdToken, verifyExtensionAccessToken } =
      createHandlers();
    verifyExtensionAccessToken.mockResolvedValue(true);

    await expect(handlers.verifyIdToken('ya29.extension-token')).resolves.toBe(
      true
    );

    expect(verifyExtensionAccessToken).toHaveBeenCalledWith(
      'ya29.extension-token'
    );
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  test('uses the verified opaque token, never a supplied access-token override', async () => {
    const { handlers, getDefaultUserInfo, getExtensionUserInfo } =
      createHandlers();
    getExtensionUserInfo.mockResolvedValue(null);

    await handlers.getUserInfo({
      idToken: 'ya29.verified-extension-token',
      accessToken: 'victim-access-token',
    });

    expect(getExtensionUserInfo).toHaveBeenCalledWith(
      'ya29.verified-extension-token'
    );
    expect(getDefaultUserInfo).not.toHaveBeenCalled();
  });

  test('delegates JWT profile mapping to Better Auth', async () => {
    const { handlers, getDefaultUserInfo, getExtensionUserInfo } =
      createHandlers();
    getDefaultUserInfo.mockResolvedValue(null);
    const tokens = {
      idToken: 'header.payload.signature',
      accessToken: 'google-api-access-token',
    };

    await handlers.getUserInfo(tokens);

    expect(getDefaultUserInfo).toHaveBeenCalledWith(tokens);
    expect(getExtensionUserInfo).not.toHaveBeenCalled();
  });
});
