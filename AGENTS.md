# AGENTS.md

This file provides guidance to Code Agents (Codex, Cursor, etc.) when working with code in this repository.

## Project Overview

**TanStarter** (mkfast-template) — a full-stack SaaS boilerplate built with TanStack Start + React 19, deployed on Cloudflare Workers. Includes auth (Better Auth), payments (Stripe / Creem / Waffo), email (Resend / Cloudflare Email), storage (Cloudflare R2), database (Cloudflare D1 via Drizzle ORM), blog (Content Collections), and admin dashboard.

## Commands

```bash
pnpm dev                    # Dev server on port 3000
pnpm build                  # Production build
pnpm deploy                 # Build + deploy to Cloudflare Workers

pnpm test                   # Vitest unit tests (tests/unit/**/*.test.ts)
pnpm test:watch             # Vitest in watch mode
pnpm e2e                    # Run local Playwright E2E tests (tests/e2e/specs)
pnpm e2e:ui                 # Run Playwright E2E in UI mode
pnpm e2e:install            # Install Playwright browser binaries
pnpm e2e:production         # Local production Worker preview smoke tests
pnpm e2e:stripe             # Stripe Test Mode suite (see tests/e2e/stripe/README.md)
pnpm e2e:creem              # Creem sandbox suite (see tests/e2e/creem/README.md)
pnpm e2e:waffo              # Waffo sandbox suite (see tests/e2e/waffo/README.md)
pnpm check                  # Local lint, unit tests, build, types, and E2E
pnpm check:production       # Separate local production Worker preview smoke

pnpm lint                   # Biome lint + format check (read-only)
pnpm typecheck              # Compile locales and content collections, then tsc
pnpm fix                    # Biome lint + format with auto-fix
pnpm format                 # Biome format only
pnpm knip                   # Find unused exports/dependencies

pnpm locale:sort            # Sort keys in project.inlang/messages/*.json
pnpm locale:check           # Verify en/zh key parity
pnpm locale:compile         # Compile the Paraglide runtime manually
pnpm content:build          # Generate content-collections modules

pnpm db:generate            # Generate Drizzle migrations from schema
pnpm db:migrate:local       # Apply migrations to local D1
pnpm db:migrate:remote      # Apply migrations to remote D1
pnpm db:push                # drizzle-kit push to the REMOTE D1 (d1-http)
pnpm db:studio:local        # Open Drizzle Studio (local)
pnpm db:studio:remote       # Open Drizzle Studio (remote)
pnpm db:sync:local          # Overwrite local D1 with a remote export (destructive)
pnpm db:admin:local <email> # Promote a user to admin in local D1
pnpm db:admin:remote <email># Promote a user to admin in remote D1

pnpm auth:schema:generate   # Regenerate Better Auth schema → src/db/auth.schema.ts
pnpm email:dev              # React Email preview on port 3333
pnpm cf-typegen             # Generate Cloudflare Worker types (also runs on postinstall)
pnpm sync-worker-secrets    # wrangler secret bulk .env.production
pnpm sync-github-secrets    # Sync .env.production to GitHub secrets + deploy.yml env
```

## Architecture

### Request Flow
Incoming request → Cloudflare Worker (`src/server.ts`) → TanStack Start handler → server functions execute (auth, DB, email) → React SSR → response with hydration state → client-side React hydration via TanStack Router.

### Key Architectural Patterns

- **File-based routing**: `src/routes/` maps to URL paths. `$param` for dynamic segments (e.g. `blog/$slug.tsx`), `$.ts` for catch-all (e.g. `api/auth/$.ts`), `(group)` for layout-only groups, `[.]` to escape a literal dot (e.g. `sitemap[.]xml.ts`), `__root.tsx` for root layout. Server-only handlers use `createFileRoute(...)({ server: { handlers } })`. Route tree auto-generates into `src/routeTree.gen.ts` — never edit this file.

- **Server functions**: Defined with `createServerFn()` from `@tanstack/react-start`. Located in `src/api/`. Use `.validator()` (Zod) and `.middleware()` chains. Called directly from client code.

- **Provider pattern**: Mail, storage, newsletter, notification, cache, and payment each use a provider abstraction (`src/*/provider/`) so implementations can be swapped (e.g., `src/mail/provider/resend.ts`, `src/storage/provider/r2.ts`).

- **Middleware** (`src/middlewares/`):
  - Route middleware (redirects): `authRouteMiddleware` (login + verified email), `adminRouteMiddleware` (admin role), `guestRouteMiddleware` (signed-out only, for login/register).
  - Server function middleware (JSON 401/403): `authApiMiddleware`, `adminApiMiddleware`. Both pass `context.userId` to the handler.

- **Environment variables**: Client-side uses `VITE_` prefix (build-time, via `src/env/client.ts`). Server-side uses Cloudflare Worker bindings/secrets (runtime, via `src/env/server.ts`). Both validated with Zod via `@t3-oss/env-core`.

### Key Source Directories

| Directory | Purpose |
|-----------|---------|
| `src/routes/` | File-based routes (pages, API handlers, webhooks) |
| `src/api/` | Server functions (ai, payment, users, contact, newsletter, user-files) |
| `src/auth/` | Better Auth config (`auth.ts` server, `client.ts` client, extension Google token handlers, trusted origins) |
| `src/middlewares/` | Route and server-function middleware (auth, admin, guest) |
| `src/db/` | Drizzle schemas (`auth.schema.ts` auto-generated, `app.schema.ts` app tables), migrations, types |
| `src/payment/` | Stripe / Creem / Waffo integration (checkout, portal, webhooks) |
| `src/mail/` | Resend / Cloudflare Email — provider, templates (React components), rendering |
| `src/storage/` | Cloudflare R2 file storage |
| `src/cache/` | Cloudflare KV JSON cache |
| `src/newsletter/` | Resend, Beehiiv, and MailCheap newsletter via API |
| `src/notification/` | Discord/Feishu webhook notifications |
| `src/locale/` | Paraglide middleware; `src/locale/paraglide/` is generated (git-ignored) |
| `src/components/ui/` | shadcn/ui components (auto-generated, excluded from linting) |
| `src/config/` | Site configuration (`website.ts` for features, providers, pricing, metadata; plus navbar, sidebar, footer, AI model config) |
| `src/lib/` | Utilities (routes, SEO, URLs, locale, price plans, payment return URLs, markdown) |
| `src/hooks/` | React hooks (auth, payment, files, etc.) |
| `project.inlang/` | Paraglide settings and source messages (`messages/en.json`, `messages/zh.json`) |
| `content/` | Markdown content (blog, pages, changelog) for Content Collections |
| `scripts/` | Tooling scripts (admin promotion, D1 sync, locale checks, payment E2E runners) |
| `tests/unit/` | Vitest unit tests |
| `tests/e2e/` | Playwright E2E specs, fixtures, and `TEST-CATALOG.md` |
| `docs/` | Module docs: ai, auth, cache, db, design, env, locale, mail, newsletter, notification, payment, storage |

### Database

Two schema files merged in `src/db/schema.ts`:
- `auth.schema.ts` — auto-generated by Better Auth (user, session, account, verification, apikey)
- `app.schema.ts` — application tables (`payment`, `userFiles`)

Types inferred from tables in `src/db/types.ts`. Access via `getDb()` from `src/db/index.ts` (it exports only `getDb`; import tables from `@/db/auth.schema`, `@/db/app.schema`, or `@/db/schema`).

### Cloudflare Bindings (wrangler.jsonc)
- `DB` — D1 database binding
- `BUCKET` — R2 storage binding
- `CACHE` — KV namespace for the cache module

## Code Style

Enforced by Biome (`biome.json`):
- 2-space indent, 80-char line width, single quotes, semicolons always, ES5 trailing commas
- Files excluded from linting: `src/components/ui/`, `src/components/data-table/`, `src/db/`, `src/routeTree.gen.ts`, `src/locale/paraglide/`, and the module `types.ts` / `index.d.ts` definition files (see `biome.json`)

### Conventions
- **File names**: kebab-case (`use-auth.ts`, `data-table.tsx`)
- **Components**: PascalCase (`DataTable`, `LoginForm`)
- **Hooks**: camelCase with `use` prefix
- **Constants**: SCREAMING_SNAKE_CASE
- **Imports**: Use `@/` path alias for all src imports. Order: external → internal (`@/`) → relative
- **Forms**: `react-hook-form` + `@hookform/resolvers` + Zod
- **State**: TanStack Query for server state (query key factory pattern)
- **Styling**: Tailwind CSS v4 with `cn()` from `src/lib/utils.ts`, class-based dark mode
- **Icons**: `@tabler/icons-react`
- **Reusable text**: Keep docs, test fixtures, comments, and error messages
  product-neutral. Mention a repository or sibling product only when its
  identity is part of the documented behavior or configuration.

### Cloudflare Workers Constraint
Avoid Node.js-specific APIs — this runs on Cloudflare Workers runtime, not Node.js.

## Unit Testing

Vitest runs `tests/unit/**/*.test.ts` in a Node environment (`vitest.config.ts`,
`@` alias to `src`). Use unit tests for pure logic and provider/webhook
behavior (auth token handling, trusted origins, payment providers, webhook
routes, return-URL normalization). `pnpm test` generates locale modules before
running Vitest; `pnpm check` includes lint, unit tests, build, type checking, and
local E2E. Production-mode preview smoke tests run separately with
`pnpm check:production`.

## E2E Testing

Playwright E2E is configured under `tests/e2e/`. E2E is local-first: use it for feature completion, release checks, and large refactors; keep CI focused on fast checks unless a dedicated E2E environment is provisioned.

### E2E Workflow

Follow `Spec → Code → Verify → Test → Green` when a user flow, route,
interaction, or behavioral contract changes:

1. **Spec**: update `tests/e2e/TEST-CATALOG.md` with the acceptance journey.
2. **Code**: implement the feature.
3. **Verify**: run the app and walk the real UI in a browser.
4. **Test**: add/update the relevant Playwright spec in `tests/e2e/specs/`.
5. **Green**: run the related spec locally; run full `pnpm e2e` before releases or large refactors.

### E2E Test Intent And Maintenance

E2E tests protect functional journeys and outcomes, not presentation contracts.
Assert behavior such as route transitions, request status, form submission,
persisted data, permission boundaries, and the availability of controls required
to complete a journey. Prefer API or database-backed state when it establishes
the outcome more directly than rendered UI.

- Presentation-only changes must not require E2E catalog or spec changes. Do
  **not** assert exact wording, translations, headings, toast copy, element
  placement or order, spacing, dimensions, colors, typography, icons, images,
  CSS classes, or other visual styling in functional E2E tests.
- Use stable locators: `data-testid` for app-owned interaction targets, then
  durable attributes such as form/input names, IDs, hrefs, and ARIA state.
  Locators identify controls; they are not assertions about how those controls
  are presented. Use visible text only when the text itself is a functional
  result, such as a user-provided value or generated file name.
- Update the catalog/spec only when the journey, state transition, route,
  permission rule, integration contract, or required interaction target
  changes. Handle accessibility requirements in dedicated tests when explicitly
  in scope. Add visual-regression tests only when the user explicitly requests
  them; do not mix either concern into functional E2E flows.

The test-only helper route `src/routes/api/e2e/users.ts` is disabled unless Vite runs locally in dev with `--mode e2e` (`import.meta.env.DEV === true` and `import.meta.env.MODE === 'e2e'`) and the request sends the matching `x-e2e-secret` header (hardcoded in the route and `tests/e2e/fixtures/test-data.ts`). Keep E2E test accounts scoped to `e2e-*@example.test`.

`pnpm e2e` starts its own server via `playwright.config.ts`: it resets `.wrangler/e2e-state`, applies D1 migrations there, and runs `vite dev --mode e2e`. Payment sandbox suites (`e2e:stripe`, `e2e:creem`, `e2e:waffo`) use their own Playwright configs and runner scripts; see the READMEs under `tests/e2e/<provider>/`.

## Commit Messages

Use the format `type(scope): summary`. The scope is required and should name
the affected module or concern. Use one of these commit types:

- `fix(scope): summary` for bug fixes.
- `feat(scope): summary` for new functionality.
- `chore(scope): summary` for maintenance, tooling, tests, or documentation.

Examples: `fix(payment): handle duplicate webhooks`,
`chore(ui): update component tooling`, and
`feat(email): add delivery status tracking`.
