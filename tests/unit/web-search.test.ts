import { describe, expect, it } from 'vitest';
import { webSearchInputSchema, webSearchResultSchema } from '@/lib/web-search';

describe('web search validation', () => {
  it('trims queries and rejects unsupported providers and oversized queries', () => {
    expect(
      webSearchInputSchema.parse({ query: ' search ', provider: 'exa' }).query
    ).toBe('search');
    for (const input of [
      { query: ' ', provider: 'ceramic' },
      { query: 'search', provider: 'unknown' },
      { query: 'x'.repeat(1025), provider: 'linkup' },
    ])
      expect(webSearchInputSchema.safeParse(input).success).toBe(false);
  });
  it('accepts empty results and rejects unsafe source links', () => {
    expect(webSearchResultSchema.parse({ items: [] }).items).toEqual([]);
    expect(
      webSearchResultSchema.safeParse({
        items: [{ title: 'Unsafe', url: 'javascript:alert(1)' }],
      }).success
    ).toBe(false);
    expect(
      webSearchResultSchema.parse({
        items: [{ title: 'Source', url: 'https://example.com' }],
      }).items
    ).toHaveLength(1);
  });
});
