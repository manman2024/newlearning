import type { User } from 'better-auth';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { getDb } from '@/db';
import { sendEmail } from '@/mail';
import { sendAuthEmail } from '@/auth/send-auth-email';
import { subscribe } from '@/newsletter';
import { getBaseUrl } from '@/lib/urls';
import { serverEnv } from '@/env/server';
import { websiteConfig } from '@/config/website';
import { createGoogleTokenHandlers } from '@/auth/google-token-handlers';
import { getTrustedOrigins } from '@/auth/trusted-origins';
import { emailHarmony } from 'better-auth-harmony';
import { apiKey } from '@better-auth/api-key';
import { admin, bearer } from 'better-auth/plugins';
import { google, verifyGoogleIdToken } from 'better-auth/social-providers';
import * as z from 'zod';
import { logOperationalEvent } from '@/lib/observability';

const trustedOrigins = getTrustedOrigins(serverEnv.BETTER_AUTH_TRUSTED_ORIGINS);

// Better Auth uses the first client ID for the website authorization URL, while
// accepting every item here as an ID-token audience. Keep the website client
// first so browser-extension tokens can be verified without changing web OAuth.
const googleIdTokenAudiences = [
  serverEnv.GOOGLE_CLIENT_ID,
  serverEnv.GOOGLE_EXTENSION_CLIENT_ID,
].filter((clientId): clientId is string => Boolean(clientId));

const googleUserInfoSchema = z.object({
  sub: z.string(),
  email: z.email(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

const verifyGoogleExtensionAccessToken = async (accessToken: string) => {
  if (!serverEnv.GOOGLE_EXTENSION_CLIENT_ID) return false;

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!response.ok) return false;

  const payload = await response.json();
  const audience = z
    .object({ aud: z.string().optional(), audience: z.string().optional() })
    .safeParse(payload);
  return (
    audience.success &&
    (audience.data.aud ?? audience.data.audience) ===
      serverEnv.GOOGLE_EXTENSION_CLIENT_ID
  );
};

const getGoogleUserInfo = async (accessToken: string) => {
  const response = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!response.ok) return null;

  const profile = googleUserInfoSchema.safeParse(await response.json());
  if (!profile.success) return null;
  return {
    user: {
      id: profile.data.sub,
      name: profile.data.name ?? '',
      email: profile.data.email,
      image: profile.data.picture,
      emailVerified: profile.data.email_verified ?? false,
    },
    data: profile.data,
  };
};

const getGoogleTokenHandlers = () => {
  const defaultGoogleProvider = google({
    clientId: googleIdTokenAudiences,
    clientSecret: serverEnv.GOOGLE_CLIENT_SECRET ?? '',
  });

  return createGoogleTokenHandlers({
    audiences: googleIdTokenAudiences,
    verifyGoogleIdToken,
    verifyExtensionAccessToken: verifyGoogleExtensionAccessToken,
    getDefaultUserInfo: defaultGoogleProvider.getUserInfo,
    getExtensionUserInfo: getGoogleUserInfo,
  });
};

/**
 * Better Auth Configuration
 * https://www.better-auth.com/docs/reference/options
 * https://www.better-auth.com/docs/adapters/drizzle
 */
export const auth = betterAuth({
  baseURL: getBaseUrl(),
  appName: websiteConfig.metadata?.name,
  // Allow explicitly configured clients, such as the browser extension, to
  // authenticate cross-origin. Keep this list in server-side environment
  // configuration so each deployment can use its own extension IDs.
  // https://www.better-auth.com/docs/reference/options#trustedorigins
  trustedOrigins,
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
  }),
  session: {
    // https://www.better-auth.com/docs/concepts/session-management#cookie-cache
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60, // Cache duration in seconds
    },
    // https://www.better-auth.com/docs/concepts/session-management#session-expiration
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // https://www.better-auth.com/docs/concepts/session-management#session-freshness
    // https://www.better-auth.com/docs/concepts/users-accounts#authentication-requirements
    // disable freshness check for user deletion
    freshAge: 0 /* 60 * 60 * 24 */,
  },
  emailAndPassword: {
    // https://discord.com/channels/1300839113142046730/1300839113594769431/1454280549060444393
    enabled: websiteConfig.auth?.enableCredentialLogin ?? false,
    // https://www.better-auth.com/docs/concepts/email#2-require-email-verification
    requireEmailVerification: true,
    // https://www.better-auth.com/docs/authentication/email-password#forget-password
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail(
        {
          to: user.email,
          template: 'forgotPassword',
          context: { url, name: user.name ?? '' },
        },
        sendEmail
      );
    },
  },
  emailVerification: {
    // https://www.better-auth.com/docs/concepts/email#auto-signin-after-verification
    autoSignInAfterVerification: true,
    // https://www.better-auth.com/docs/authentication/email-password#require-email-verification
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail(
        {
          to: user.email,
          template: 'verifyEmail',
          context: { url, name: user.name ?? '' },
        },
        sendEmail
      );
    },
    sendOnSignIn: true,
  },
  socialProviders: {
    // https://www.better-auth.com/docs/authentication/google
    ...(websiteConfig.auth?.enableGoogleLogin &&
    serverEnv.GOOGLE_CLIENT_ID &&
    serverEnv.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: googleIdTokenAudiences,
            clientSecret: serverEnv.GOOGLE_CLIENT_SECRET,
            ...getGoogleTokenHandlers(),
          },
        }
      : {}),
  },
  account: {
    // https://www.better-auth.com/docs/concepts/users-accounts#account-linking
    accountLinking: {
      enabled: websiteConfig.auth?.enableGoogleLogin,
      trustedProviders: websiteConfig.auth?.enableGoogleLogin ? ['google'] : [],
    },
  },
  user: {
    // https://www.better-auth.com/docs/concepts/database#extending-core-schema
    additionalFields: {
      customerId: {
        type: 'string',
        required: false,
        // Payment providers own this mapping; public auth inputs must not set it.
        input: false,
      },
    },
    // https://www.better-auth.com/docs/concepts/users-accounts#delete-user
    deleteUser: {
      enabled: websiteConfig.auth?.enableDeleteAccount ?? false,
    },
  },
  databaseHooks: {
    // https://www.better-auth.com/docs/concepts/database#database-hooks
    user: {
      create: {
        after: async (user) => {
          await onCreateUser(user);
        },
      },
    },
  },
  plugins: [
    // https://www.better-auth.com/docs/plugins/bearer
    // Let the browser extension authenticate via `Authorization: Bearer
    // <token>`; the token is returned in the `set-auth-token` header.
    bearer(),
    // https://www.better-auth.com/docs/plugins/admin
    // support user management, ban/unban user, manage user roles, etc.
    admin({
      // https://www.better-auth.com/docs/plugins/admin#default-ban-reason
      // defaultBanReason: 'Spamming',
      defaultBanExpiresIn: undefined,
      bannedUserMessage:
        'You have been banned from this application. Please contact support if you believe this is an error.',
    }),
    // https://www.better-auth.com/docs/plugins/api-key
    // support API key management for user authentication
    apiKey(),
    // https://github.com/gekorm/better-auth-harmony
    // email normalization and validation to prevent duplicate registrations
    emailHarmony({
      // Don't allow login with any version of the unnormalized email address
      // e.g., user signed up with johndoe@googlemail.com can't login with john.doe@gmail.com
      // e.g., user signed up with johndoe@googlemail.com can't login with johndoe+abc@gmail.com
      allowNormalizedSignin: false,
    }),
    // https://www.better-auth.com/docs/integrations/tanstack
    // Cookie integration must be last so earlier plugin cookies are forwarded.
    tanstackStartCookies(),
  ],
  onAPIError: {
    // https://www.better-auth.com/docs/reference/options#onapierror
    errorURL: '/auth/error',
    onError: (error, _ctx) => {
      logOperationalEvent.error('auth error:', error);
    },
  },
});

/**
 * Runs after a new user is created. Auto-subscribes to newsletter when enabled.
 */
async function onCreateUser(user: User) {
  if (import.meta.env.DEV && import.meta.env.MODE === 'e2e') return;
  const newsletterConfig = websiteConfig.newsletter;
  if (
    !user.email ||
    !newsletterConfig?.enable ||
    !newsletterConfig.autoSubscribeAfterSignUp
  ) {
    return;
  }

  try {
    const subscribed = await subscribe(user.email);
    if (!subscribed) {
      logOperationalEvent.error(
        `onCreateUser, user ${user.email} failed to subscribe`
      );
    } else {
      logOperationalEvent.log(
        `onCreateUser, user ${user.email} subscribed to newsletter`
      );
    }
  } catch (error) {
    logOperationalEvent.error(
      'onCreateUser, newsletter subscription error:',
      error
    );
  }
}
