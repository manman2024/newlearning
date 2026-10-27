import { env } from 'cloudflare:workers';
import { MIN_CACHE_TTL_SECONDS } from '../constants';
import type { CacheProvider } from '../types';

function getCacheBinding(): KVNamespace | undefined {
  return (env as unknown as { CACHE?: KVNamespace }).CACHE;
}

export class KvCacheProvider implements CacheProvider {
  getProviderName(): string {
    return 'kv';
  }

  private getCache(): KVNamespace | undefined {
    return getCacheBinding();
  }

  async getJson<T>(key: string): Promise<T | null> {
    const cache = this.getCache();
    if (!cache) return null;

    return cache.get<T>(key, 'json');
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const cache = this.getCache();
    if (!cache) return;

    const ttl = Math.max(MIN_CACHE_TTL_SECONDS, Math.floor(ttlSeconds));
    await cache.put(key, JSON.stringify(value), { expirationTtl: ttl });
  }

  async delete(key: string): Promise<void> {
    const cache = this.getCache();
    if (!cache) return;

    await cache.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const cache = this.getCache();
    if (!cache) return;

    let cursor: string | undefined;
    do {
      const result = await cache.list({ prefix, cursor });
      await Promise.all(result.keys.map((key) => cache.delete(key.name)));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
  }
}
