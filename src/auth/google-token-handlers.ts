import type { google, verifyGoogleIdToken } from 'better-auth/social-providers';

type GoogleTokens = Parameters<ReturnType<typeof google>['getUserInfo']>[0];
type GoogleUserInfo = Awaited<
  ReturnType<ReturnType<typeof google>['getUserInfo']>
>;

type GoogleTokenHandlersOptions = {
  audiences: string[];
  verifyGoogleIdToken: typeof verifyGoogleIdToken;
  verifyExtensionAccessToken: (token: string) => Promise<boolean>;
  getDefaultUserInfo: (tokens: GoogleTokens) => Promise<GoogleUserInfo>;
  getExtensionUserInfo: (accessToken: string) => Promise<GoogleUserInfo>;
};

export const isGoogleIdToken = (token: string) => token.split('.').length === 3;

/**
 * Google browser extensions receive opaque OAuth access tokens, while Better
 * Auth's direct sign-in API expects an ID token. Keep the two flows separate:
 * JWTs use Google's built-in ID-token verification and profile mapping; opaque
 * extension tokens can only retrieve user info with the same verified token.
 */
export const createGoogleTokenHandlers = ({
  audiences,
  verifyGoogleIdToken: verifyIdToken,
  verifyExtensionAccessToken,
  getDefaultUserInfo,
  getExtensionUserInfo,
}: GoogleTokenHandlersOptions) => ({
  verifyIdToken: async (token: string, nonce?: string) => {
    if (isGoogleIdToken(token)) {
      return Boolean(
        await verifyIdToken({ token, audience: audiences, nonce })
      );
    }

    return verifyExtensionAccessToken(token);
  },
  getUserInfo: (tokens: GoogleTokens) => {
    if (!tokens.idToken) return Promise.resolve(null);

    return isGoogleIdToken(tokens.idToken)
      ? getDefaultUserInfo(tokens)
      : getExtensionUserInfo(tokens.idToken);
  },
});
