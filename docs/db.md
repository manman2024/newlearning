# DB module

The database uses **Drizzle ORM** with **Cloudflare D1** (SQLite). D1 is configured via **bindings** in `wrangler.jsonc`, not environment variables (see [Env](./env.md) for project env overview). Table definitions live in two files: **auth.schema.ts** (Better Auth, script-generatable) and **app.schema.ts** (application tables). Both are merged in **schema.ts** into a single schema for Drizzle and migrations.

## Directory structure

```
src/db/
├── index.ts       # getDb() using env.DB (cloudflare:workers); exports only getDb
├── schema.ts      # Re-exports all tables and builds `schema` from auth.schema + app.schema
├── auth.schema.ts # Better Auth: user, session, account, verification, apikey + relations
├── app.schema.ts  # Application tables: payment, userFiles + relations
├── types.ts       # User, ApiKey, UserFiles, Payment ($inferSelect from tables)
└── migrations/    # Drizzle-generated SQL and meta
```

## Configuration

- **wrangler.jsonc**
  - `d1_databases`: `binding: "DB"`, `database_id`, `database_name`, `migrations_dir: "./src/db/migrations"`.
- At runtime the D1 instance is available as `env.DB` (Cloudflare Workers). The project uses `import { env } from "cloudflare:workers"` in `getDb()`, so no argument is passed.

## Core API

- **getDb()** (`@/db`)
  - Returns `drizzle(env.DB, { schema })` for all server-side DB access. Called without arguments.
  - `@/db` exports nothing else. Import tables from `@/db/auth.schema`, `@/db/app.schema`, or `@/db/schema` (which re-exports both).

- **types.ts**
  - `User`, `ApiKey`, `UserFiles`, `Payment` — inferred from table `$inferSelect`. Use for API responses and admin tables.

## Schema design

- **auth.schema.ts**
  - Tables required by Better Auth:
    - `user`: name, email, emailVerified, image, plus `role`, `banned`, `banReason`, `banExpires` (admin plugin), `normalizedEmail` (email harmony), and `customerId` (payment customer mapping).
    - `session`, `account`, `verification`, `apikey`.
    - Relations: `userRelations`, `sessionRelations`, `accountRelations`.
  - Regenerate with `pnpm auth:schema:generate`; do not add application tables here. `customerId` survives regeneration because `src/auth/auth.ts` declares it in `user.additionalFields`.

- **app.schema.ts**
  - `payment` — subscriptions and one-time purchases written by payment webhooks (see [Payment](./payment.md)).
  - `userFiles` (`user_files`) — metadata for private user uploads (see [Storage](./storage.md)).
  - Define new application tables here with `sqliteTable('my_table', { ... })`; `schema.ts` picks them up automatically.

- **schema.ts**
  - Re-exports all tables from `auth.schema` and `app.schema` so drizzle-kit can discover them, and exports `schema = { ...authSchema, ...appSchema }` for `getDb()`.

## Migrations

Current migrations in `src/db/migrations/`:

| Migration | Change |
|-----------|--------|
| `0000_cultured_rick_jones` | Better Auth tables (`user`, `session`, `account`, `verification`, `apikey`) |
| `0001_tired_moondragon` | `user_files` |
| `0002_hard_dexter_bennett` | `payment` and `user.customer_id` |
| `0003_steady_stryfe` | Indexes on `payment (user_id, paid)`, `user_files (user_id)`, `user_files (r2_key)` |
| `0004_curious_leper_queen` | Rebuild `apikey` for the `@better-auth/api-key` schema (`config_id`, `reference_id`) |

Commands:

- **Generate**: `pnpm db:generate` — runs `drizzle-kit generate` with the default `drizzle.config.ts`, which uses the D1 HTTP driver and needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_API_TOKEN`.
- **Apply**:
  - Local D1: `pnpm db:migrate:local`.
  - Remote D1: `pnpm db:migrate:remote`.
  - Both run `wrangler d1 migrations apply <name>`; the database name is read from `wrangler.jsonc` by `scripts/get-db-name.ts`.
- **Push schema**: `pnpm db:push` runs `drizzle-kit push` with `drizzle.config.ts`, so it writes directly to the **remote** D1 database without a migration file. Prefer migrations for anything you deploy.
- **drizzle-kit configs**:
  - Remote: `drizzle.config.ts` (D1 HTTP + account credentials); used by `db:generate`, `db:push`, `db:studio:remote`.
  - Local: `drizzle.config.local.ts`; finds the SQLite file under `.wrangler/state/v3/d1/miniflare-D1DatabaseObject` (skipping `metadata*` files) and falls back to `file:./dev.db`. Used by `db:studio:local`.

## Sync remote data to local

```bash
pnpm db:sync:local
```

`scripts/sync-d1-remote-to-local.ts` exports the remote D1 database and **overwrites** the local D1 database with it. It asks for confirmation unless `--yes` (`-y`) is passed.

Options: `--database` / `--db` / `--binding`, `--env` / `-e`, `--config` / `-c`, `--env-file`, `--persist-to`, `--keep-dump`, `--verbose`, `--help`.

## Admin role

Promote an existing user by email without using the admin dashboard:

```bash
pnpm db:admin:local user@example.com
pnpm db:admin:remote user@example.com
```

Both commands read the D1 database name from `wrangler.jsonc`, match the email
case-insensitively, and verify the stored role after updating it. They exit
without writing if the email does not exist and are safe to repeat for a user
who is already an admin. The user should sign out and sign in again afterward
to refresh Better Auth's cached session.

## Consumers

- **Auth** (`src/auth/auth.ts`): `drizzleAdapter(getDb(), { provider: 'sqlite' })`; Better Auth reads/writes user, session, account, verification, apikey.
- **Payment** (`src/payment/provider/*`): reads/writes `payment` and `user.customerId`.
- **Storage** (`src/api/user-files.ts`, `src/routes/api/storage/file.ts`): reads/writes `userFiles`.
- Other server logic: `import { getDb } from '@/db'`, then import tables from `@/db/auth.schema` / `@/db/app.schema`.

## Notes

- D1 is SQLite; use Drizzle’s SQLite dialect (`sqliteTable`, `text`, `integer`, etc.).
- All DB access must run in the Worker or server; `getDb` depends on `D1Database` and is not for use in the browser.
