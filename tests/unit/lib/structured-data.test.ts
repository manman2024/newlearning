import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/website', () => ({
  websiteConfig: {
    metadata: { name: 'Example', description: 'Example site' },
    social: {},
  },
}));
vi.mock('@/lib/urls', () => ({
  getCanonicalUrlForLocale: (path: string, locale: string) =>
    `https://example.com${locale === 'zh' ? '/zh' : ''}${path}`,
  getImageUrl: (path: string) => `https://example.com${path}`,
}));
vi.mock('@/lib/locale', () => ({
  localeConfig: { en: { hreflang: 'en' }, zh: { hreflang: 'zh-CN' } },
}));

import { jsonLdScript, pageStructuredData } from '@/lib/structured-data';

describe('structured data', () => {
  it('keeps embedded HTML inert without changing the JSON value', () => {
    const value = { name: '</script><script>alert(1)</script>' };
    const { children } = jsonLdScript(value);
    expect(children).not.toContain('<');
    expect(JSON.parse(children)).toEqual(value);
  });

  it('uses the resolved canonical locale and pagination URL', () => {
    const [script] = pageStructuredData('/blog', {
      url: 'https://example.com/zh/blog?page=2',
      title: 'Blog',
      locale: 'zh',
    });
    const graph = JSON.parse(script.children)['@graph'];
    expect(graph[2].url).toBe('https://example.com/zh/blog?page=2');
    expect(graph[2].inLanguage).toBe('zh-CN');
    expect(graph[2].isPartOf['@id']).toBe(graph[1]['@id']);
    expect(graph[1].publisher['@id']).toBe(graph[0]['@id']);
  });

  it('does not add public markup to private or error pages', () => {
    for (const path of [
      '/auth/login',
      '/dashboard',
      '/settings/billing',
      '/admin',
      '/test-404',
    ]) {
      expect(
        pageStructuredData(path, {
          url: `https://example.com${path}`,
          title: 'Page',
          locale: 'en',
        })
      ).toEqual([]);
    }
  });
});
