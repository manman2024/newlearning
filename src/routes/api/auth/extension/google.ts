import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { auth } from '@/auth/auth';
import { serverEnv } from '@/env/server';
import {
  getTrustedExtensionOrigins,
  getTrustedOrigins,
  isTrustedExtensionOrigin,
} from '@/auth/trusted-origins';

const requestSchema = z.object({
  accessToken: z.string().min(1),
});

const trustedExtensionOrigins = getTrustedExtensionOrigins(
  getTrustedOrigins(serverEnv.BETTER_AUTH_TRUSTED_ORIGINS)
);

export const Route = createFileRoute('/api/auth/extension/google')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          !isTrustedExtensionOrigin(
            request.headers.get('Origin'),
            trustedExtensionOrigins
          )
        ) {
          return new Response('Forbidden', { status: 403 });
        }

        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return new Response('Bad Request', { status: 400 });
        }

        const { accessToken } = parsed.data;
        if (!serverEnv.GOOGLE_EXTENSION_CLIENT_ID) {
          return new Response('OAuth client is not configured', {
            status: 503,
          });
        }

        const session = await auth.api.signInSocial({
          body: {
            provider: 'google',
            idToken: {
              token: accessToken,
              accessToken,
            },
          },
          headers: request.headers,
        });
        if (!('token' in session) || !session.token) {
          return new Response('Session creation failed', { status: 502 });
        }

        return Response.json({ token: session.token });
      },
    },
  },
});
