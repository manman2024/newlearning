# Cache module

The cache module provides server-side JSON caching through **Cloudflare KV**.
It is intended for low-risk, read-heavy data such as remote provider status
checks, public lists, and expensive-but-cacheable API responses.

KV is eventually consistent, so do not use it as the source of truth for
payments, auth, quotas, or other strongly consistent state.

## Enabling cache

1. **Create the KV namespace** (once per environment):

   ```bash
   pnpm wrangler kv namespace create CACHE
   ```

   Copy the returned `id`.

2. **Configure the namespace in `wrangler.jsonc`**:

   ```jsonc
   "kv_namespaces": [
     {
       "binding": "CACHE",
       "id": "<KV_NAMESPACE_ID>"
     }
   ]
   ```

   The Worker receives the namespace as `env.CACHE`.

3. **Enable cache in website config** (`src/config/website.ts`):

   ```ts
   cache: {
     enable: true,
     provider: 'kv',
   },
   ```

## Directory structure

```txt
src/cache/
├── index.ts           # getOrSetCache, deleteCache, deleteCacheByPrefix, getCacheProvider, provider registry
├── constants.ts       # key prefix, version, TTL values
├── types.ts           # CacheProvider interface
├── utils.ts           # stable cache key helpers
└── provider/
    └── kv.ts          # Cloudflare KV provider
```

## Core API

All exports come from `@/cache` (`CACHE_TTL` and `createCacheKey` are
re-exported from `constants.ts` and `utils.ts`).

- **getOrSetCache({ key, ttlSeconds, fetcher })**
  - Reads JSON from cache. On miss or cache read failure, calls `fetcher()`
    and stores the result. Write failures are logged and ignored.
  - If `fetcher()` throws, the error propagates and nothing is cached. A
    resolved value is cached as-is, including `false` or an error-shaped
    object, so return errors by throwing when they must not be cached.

- **deleteCache(key)**
  - Deletes one cache entry. Use this after mutations. Failures are logged.

- **deleteCacheByPrefix(prefix)**
  - Lists all keys under a prefix and deletes them in parallel, page by page.
    Useful for list caches. Pass `` `${createCacheKey(scope)}:` `` to target
    only keys created with parts for that scope.

- **createCacheKey(scope, parts?)**
  - Format: `app-cache:v1:<scope>` without parts, or
    `app-cache:v1:<scope>:<hash>` with parts. `parts` is
    stable-JSON-stringified and hashed (FNV-1a), so keys never contain raw
    values such as email addresses.
  - Bump `CACHE_VERSION` in `constants.ts` to invalidate every key at once.
    You do not need a separate namespace in `websiteConfig`.

- **getCacheProvider()**
  - Returns the lazily created provider, or `null` when `cache.enable` is
    false or no provider is set.

## Current consumers

- **Newsletter status** (`src/api/newsletter.ts`)
  - `getNewsletterStatus` caches provider status checks for
    `CACHE_TTL.newsletterStatus` (10 minutes) under
    `createCacheKey('newsletter:status', email)`.
  - `subscribeNewsletter` and `unsubscribeNewsletter` delete the corresponding
    status cache key after a successful mutation.

This is currently the only consumer.

## Notes

- TTL values live in `src/cache/constants.ts`, not `websiteConfig`, so product
  configuration stays focused on provider selection. TTLs are clamped to at
  least `MIN_CACHE_TTL_SECONDS` (60), the KV minimum.
- If `cache.enable` is false, `getOrSetCache` calls `fetcher()` directly and
  the delete helpers do nothing.
- If `CACHE` is not bound, KV reads return a miss and writes/deletes are
  skipped, so callers fall back to the underlying `fetcher()`.
- `wrangler.jsonc` already binds `CACHE` for the template; replace the
  namespace ID with your own.
