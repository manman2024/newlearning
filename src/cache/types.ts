/**
 * Supported cache provider names.
 */
export type CacheProviderName = 'kv';

export type CacheOptions<T> = {
  key: string;
  ttlSeconds: number;
  fetcher: () => Promise<T>;
};

export interface CacheProvider {
  getProviderName(): string;
  getJson<T>(key: string): Promise<T | null>;
  setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}
