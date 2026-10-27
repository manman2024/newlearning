// DO NOT DELETE THIS FILE!!!
// This file is a good smoke test to make sure the custom server entry is working
import { logOperationalEvent } from '@/lib/observability';
import handler from '@tanstack/react-start/server-entry';
import { localeMiddleware } from '@/locale/middleware';
import { getUnavailableContentRedirect } from '@/lib/content-links';
import { serverEnv } from '@/env/server';
import {
  getTrustedExtensionOrigins,
  getTrustedOrigins,
  isTrustedExtensionOrigin,
} from '@/auth/trusted-origins';

/**
 * TanStack Start server entry
 * https://github.com/backpine/tanstack-start-on-cloudflare/blob/main/src/server.ts
 */
logOperationalEvent.info(
  "[server-entry]: using custom server entry in 'src/server.ts'"
);

/**
 * CORS support for the browser extension (mkext-template).
 * Extension requests arrive with `Origin: chrome-extension://<id>`. We only add
 * CORS headers for that origin so normal web/SSR traffic is completely unaffected.
 * Bearer-token auth is used (not cookies), so credentials are not required.
 */
const trustedExtensionOrigins = getTrustedExtensionOrigins(
  getTrustedOrigins(serverEnv.BETTER_AUTH_TRUSTED_ORIGINS)
);

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'set-auth-token',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get('Origin');

    // Preflight from the extension: answer directly, don't hit the app handler.
    if (
      isTrustedExtensionOrigin(origin, trustedExtensionOrigins) &&
      request.method === 'OPTIONS'
    ) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const url = new URL(request.url);
      const target = getUnavailableContentRedirect(url.pathname);
      if (target) {
        url.pathname = target;
        return Response.redirect(url, 308);
      }
    }

    const response = await localeMiddleware(request, () =>
      handler.fetch(request, {
        context: {
          fromFetch: true,
        },
      })
    );

    // Add CORS headers to extension responses (clone so headers stay mutable).
    if (isTrustedExtensionOrigin(origin, trustedExtensionOrigins)) {
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(origin))) {
        headers.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  },
};
