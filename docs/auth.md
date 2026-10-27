# Auth module

Authentication is built on [Better Auth](https://www.better-auth.com/). The server uses D1 (Drizzle) with email verification and password reset via the Mail module. The client uses `better-auth/react`'s `createAuthClient`, integrated with TanStack Start via `tanstackStartCookies`.

---

## Directory structure

```
src/auth/
├── auth.ts                  # Server: betterAuth instance (DB, email, social, plugins, hooks)
├── client.ts                # Client: createAuthClient + plugins (admin, apiKey, inferAdditionalFields)
├── google-token-handlers.ts # Google verifyIdToken / getUserInfo for web ID tokens and extension access tokens
├── trusted-origins.ts       # Parse BETTER_AUTH_TRUSTED_ORIGINS and match extension origins
└── types.ts                 # Session / SessionUser types inferred from auth
```

**Related (outside `src/auth/`):**

- **API routes**:
  - `src/routes/api/auth/$.ts` — forwards GET/POST to `auth.handler(request)`.
  - `src/routes/api/auth/extension/google.ts` — `POST /api/auth/extension/google` for the browser extension (see [Browser extension auth](#browser-extension-auth)).
- **CORS**: `src/server.ts` adds CORS headers only for trusted extension origins.
- **Middleware**: `src/middlewares/auth-middleware.ts`, `admin-middleware.ts`, `guest-middleware.ts`. All use `auth.api.getSession({ headers })`; there is no separate `lib/session.ts`.
- **Routes**: `src/routes/auth.tsx` (layout), `auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`, `auth/error`.
- **Components**: `src/components/auth/` (login-form, register-form, forgot-password-form, reset-password-form, auth-card, error-card, login-wrapper, social-login-button, etc.); `UserButton`, `SidebarUser` use `SessionUser` from `@/auth/types`.
- **Hooks**: `src/hooks/use-auth.ts` — `useUserAccounts`, `useHasCredentialProvider`.
- **DB user type**: `src/db/types.ts` exports `User` (table row); use for admin user list/detail. Use `SessionUser` from `@/auth/types` for current-session user (e.g. navbar, sidebar).

---

## Server (auth.ts)

- **baseURL**: From `getBaseUrl()` (build-time `VITE_BASE_URL`).
- **appName**: `websiteConfig.metadata.name`.
- **trustedOrigins**: Parsed from `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated).
- **database**: `drizzleAdapter(getDb(), { provider: 'sqlite' })`. `getDb()` (from `@/db`) uses the Worker's **`env.DB`** D1 binding.
- **session**:
  - `cookieCache`: enabled, `maxAge` 1 hour.
  - `expiresIn`: 7 days; `updateAge`: 1 day.
  - `freshAge: 0` — freshness check disabled so users can delete their account without re-authenticating.
- **emailAndPassword**:
  - Enabled when `websiteConfig.auth.enableCredentialLogin` is true.
  - `requireEmailVerification: true`.
  - `sendResetPassword`: calls Mail module `sendEmail({ template: 'forgotPassword', ... })`.
  - No server-side minimum password length is configured, so Better Auth's default applies. The register and reset-password forms require at least 8 characters.
- **emailVerification**:
  - `sendVerificationEmail`: calls `sendEmail({ template: 'verifyEmail', ... })`.
  - `sendOnSignIn: true` — an unverified user who signs in receives a new verification email.
  - `autoSignInAfterVerification: true`.
- **socialProviders**: Google when `websiteConfig.auth.enableGoogleLogin` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set.
  - `clientId` is an array: `[GOOGLE_CLIENT_ID, GOOGLE_EXTENSION_CLIENT_ID]` (empty values removed). Better Auth uses the first ID for the website authorization URL and accepts every ID as an ID-token audience, so keep the website client first.
  - Custom `verifyIdToken` / `getUserInfo` handlers from `google-token-handlers.ts`: JWT ID tokens use Google ID-token verification; opaque extension access tokens are checked against Google tokeninfo (audience must equal `GOOGLE_EXTENSION_CLIENT_ID`) and the profile is loaded from Google userinfo.
- **account**: Account linking enabled when Google login is enabled; trusted provider `google`.
- **user**:
  - `additionalFields.customerId` (`string`, optional, `input: false`). Payment providers own this mapping; sign-up and `updateUser` cannot set it.
  - `deleteUser.enabled`: `websiteConfig.auth.enableDeleteAccount` (default `false`).
- **databaseHooks**: `user.create.after` auto-subscribes the new user's email to the newsletter when `websiteConfig.newsletter.enable` and `autoSubscribeAfterSignUp` are both true. Failures are logged, not thrown.
- **plugins** (order matters):
  1. `bearer()` — `Authorization: Bearer <token>` auth for the browser extension; the token is returned in the `set-auth-token` header.
  2. `admin()` — user management, ban/unban, roles; `bannedUserMessage` and optional `defaultBanExpiresIn`.
  3. `apiKey()` — API key management for users (from the `@better-auth/api-key` package).
  4. `emailHarmony()` — email normalization/validation (`better-auth-harmony`); `allowNormalizedSignin: false`.
  5. `tanstackStartCookies()` — must be **last** so cookies set by earlier plugins are forwarded.
- **onAPIError**: `errorURL: '/auth/error'`; errors are logged with `console.error`.

---

## Client (client.ts)

- `createAuthClient({ baseURL: getBaseUrl(), plugins: [adminClient(), apiKeyClient(), inferAdditionalFields<typeof auth>()] })` exported as **`authClient`**. `apiKeyClient` comes from `@better-auth/api-key/client`.
- Typical usage:
  - `authClient.useSession()` — current session (includes user with role when admin plugin is used).
  - `authClient.signIn.email()`, `authClient.signUp.email()`, `authClient.signOut()`.
  - `authClient.updateUser({ name, image })` — e.g. profile/avatar.
  - `authClient.listAccounts()` — used by `useUserAccounts` in `use-auth.ts`.

Requests go to `baseURL + /api/auth/*` and are handled by `auth.handler`.

---

## Middleware

All middleware lives in `src/middlewares/` and calls `auth.api.getSession({ headers })`.

### Route middleware (redirects)

Use in route definitions via `server: { middleware: [...] }`. When `websiteConfig.auth.enable` is false, all route middleware redirects to `Routes.Root`.

| Export | File | Behavior | Used by |
|--------|------|----------|---------|
| `authRouteMiddleware` | `auth-middleware.ts` | No session → `Routes.Login`. Unverified email → `Routes.Login?error=email_not_verified`. | `dashboard.tsx`, `settings.tsx` |
| `adminRouteMiddleware` | `admin-middleware.ts` | No session → `Routes.Login`. Role not `admin` → `Routes.Dashboard`. | `admin.tsx` |
| `guestRouteMiddleware` | `guest-middleware.ts` | Signed-in user → `DEFAULT_LOGIN_REDIRECT`. | `auth/login.tsx`, `auth/register.tsx` |

### Server function middleware (JSON responses)

Use with `createServerFn().middleware([...])`. Both pass `context.userId` to the handler.

| Export | File | Behavior |
|--------|------|----------|
| `authApiMiddleware` | `auth-middleware.ts` | No session → 401 `{ error: 'Unauthorized' }`. Unverified email → 403 `{ error, code: 'email_not_verified' }`. |
| `adminApiMiddleware` | `admin-middleware.ts` | No session → 401. Role not `admin` → 403. |

### API routes

File routes with server handlers (e.g. `routes/api/storage/file.ts`) call `auth.api.getSession({ headers })` directly and return 401/403 when the session is missing or ownership fails. Uploads use the `uploadUserFile` server function with `authApiMiddleware`, not an API route.

---

## Configuration and environment

- **websiteConfig.auth** (`src/config/website.ts`): `enable`, `enableGoogleLogin`, `enableCredentialLogin`, `enableDeleteAccount`.
- **D1**: Configure `d1_databases` in `wrangler.jsonc` with binding name **`DB`**; `getDb()` uses `env.DB`.
- **Mail**: Verification and password reset depend on the Mail module (see [Mail](./mail.md)).
- **Google OAuth**: Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in server env. Full list: [Env](./env.md).

---

## Browser extension auth

The template supports `mkext-template` (Chrome and Firefox) with bearer tokens instead of cookies.

- **Trusted origins**: Add each extension origin to `BETTER_AUTH_TRUSTED_ORIGINS`, e.g. `chrome-extension://<extension-id>`. Chrome origins must match exactly. `moz-extension://*` is an explicit opt-in that trusts any Firefox extension origin, because Firefox assigns a per-profile UUID.
- **CORS** (`src/server.ts`): Only for trusted extension origins:
  - `OPTIONS` preflight is answered directly with `204`.
  - Responses get `Access-Control-Allow-Origin: <origin>`, `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Content-Type, Authorization`, `Expose-Headers: set-auth-token`, and `Vary: Origin`.
  - Normal web and SSR traffic is unaffected.
- **Browser-native Google OAuth**: The extension uses the manifest `oauth2` configuration and `browser.identity.getAuthToken()`, then posts `{ accessToken }` to `POST /api/auth/extension/google`. Configure `GOOGLE_EXTENSION_CLIENT_ID`. The route:
  - returns `403` unless `Origin` is a trusted extension origin;
  - returns `400` for an invalid body;
  - returns `503` when `GOOGLE_EXTENSION_CLIENT_ID` is not set;
  - calls `auth.api.signInSocial` with the access token (verified via tokeninfo audience);
  - returns `{ token }` on success, or `502` if no session token was created.

---

## Database tables

Better Auth tables are defined in **`src/db/auth.schema.ts`**: `user` (with `role`, `banned`, `banReason`, `banExpires`, `normalizedEmail`, `customerId`), `session`, `account`, `verification`, `apikey`. `customerId` is declared in `additionalFields` so it survives `pnpm auth:schema:generate`. Schema is merged in `src/db/schema.ts`. Migrations and Drizzle usage are described in the [DB module](./db.md).

## Authentication email failures

- Verification and reset emails try up to 3 times, 250 ms apart, using the same
  link (`MAX_SEND_ATTEMPTS` in `src/auth/send-auth-email.ts`).
- Signup success does not guarantee email delivery. Signup and unverified-login
  forms offer resend; failed delivery returns 503, while acceptance starts a
  60-second cooldown (`RESEND_COOLDOWN_SECONDS` in the resend component).
- Password reset returns the same response for missing accounts and send failure.
- Worker logs record `auth.mail.accepted`, `auth.mail.attempt_failed` and
  `auth.mail.delivery_failed`, without recipients, links or raw provider errors.
- Local `--mode e2e` uses test mail only. Verify real-provider delivery and email
  links separately before release.
