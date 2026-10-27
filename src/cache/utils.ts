import { CACHE_KEY_PREFIX, CACHE_VERSION } from './constants';

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

function normalizeForJson(value: unknown): JsonValue {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item));
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce<Record<string, JsonValue>>((acc, key) => {
        acc[key] = normalizeForJson(input[key]);
        return acc;
      }, {});
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export function createCacheKey(scope: string, parts?: unknown): string {
  const base = `${CACHE_KEY_PREFIX}:${CACHE_VERSION}:${scope}`;
  if (parts === undefined) return base;

  return `${base}:${hashString(stableStringify(parts))}`;
}
