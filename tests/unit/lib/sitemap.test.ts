import { describe, expect, it } from 'vitest';
import { renderSitemap } from '@/lib/sitemap';

const entries = (xml: string) =>
  [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);

describe('renderSitemap', () => {
  it('emits one canonical loc per translated static page with reciprocal alternates', () => {
    const urls = entries(
      renderSitemap('https://example.com/', [{ path: '/about' }])
    );
    expect(urls).toHaveLength(2);
    expect(urls.map((url) => url.match(/<loc>(.*?)<\/loc>/)?.[1])).toEqual([
      'https://example.com/about',
      'https://example.com/zh/about',
    ]);
    for (const url of urls) {
      expect(url).toContain('hreflang="en" href="https://example.com/about"');
      expect(url).toContain(
        'hreflang="zh-CN" href="https://example.com/zh/about"'
      );
      expect(url).toContain(
        'hreflang="x-default" href="https://example.com/about"'
      );
    }
  });

  it('omits absent translations and their alternates', () => {
    const urls = entries(
      renderSitemap('https://example.com', [
        { path: '/blog/english-only', availableLocales: ['en'] },
        { path: '/blog/chinese-only', availableLocales: ['zh'] },
        { path: '/blog/missing', availableLocales: [] },
      ])
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(
      '<loc>https://example.com/blog/english-only</loc>'
    );
    expect(urls[0]).not.toContain('hreflang="zh-CN"');
    expect(urls[1]).toContain(
      '<loc>https://example.com/zh/blog/chinese-only</loc>'
    );
    expect(urls[1]).not.toContain('hreflang="en"');
    expect(urls[1]).not.toContain('hreflang="x-default"');
    expect(urls.join('')).not.toContain('/blog/missing');
  });

  it('does not invent translated URLs for nonlocalized paths', () => {
    const urls = entries(
      renderSitemap('https://example.com', [{ path: '/internal' }])
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('<loc>https://example.com/internal</loc>');
    expect(urls[0]).not.toContain('alternate');
  });
});
