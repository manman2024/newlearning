import { describe, expect, it } from 'vitest';
import {
  getContentHref,
  getUnavailableContentRedirect,
} from '@/lib/content-links';

const onlyEnglish = () => ['en'] as const;
const onlyChinese = () => ['zh'] as const;

describe('content links for missing translations', () => {
  it('links to the available source document', () => {
    expect(getContentHref('/terms', 'zh', onlyEnglish())).toBe('/terms');
    expect(getContentHref('/blog/post', 'en', onlyChinese())).toBe(
      '/zh/blog/post'
    );
  });

  it('redirects missing localized content while leaving available and unrelated URLs alone', () => {
    expect(getUnavailableContentRedirect('/zh/blog/post', onlyEnglish)).toBe(
      '/blog/post'
    );
    expect(getUnavailableContentRedirect('/zh/terms', onlyEnglish)).toBe(
      '/terms'
    );
    expect(
      getUnavailableContentRedirect('/zh/privacy', onlyChinese)
    ).toBeNull();
    expect(
      getUnavailableContentRedirect('/zh/about', () => undefined)
    ).toBeNull();
    expect(getUnavailableContentRedirect('/terms', onlyChinese)).toBeNull();
  });
});
