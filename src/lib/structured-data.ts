import { websiteConfig } from '@/config/website';
import { getCanonicalUrlForLocale, getImageUrl } from '@/lib/urls';
import { localeConfig, type Locale } from '@/lib/locale';

export function jsonLdScript(data: unknown) {
  return {
    type: 'application/ld+json',
    // Prevent content containing HTML from terminating the script element.
    children: JSON.stringify(data).replace(/</g, '\\u003c'),
  };
}

export function organizationStructuredData(locale: Locale) {
  const url = getCanonicalUrlForLocale('/', locale);
  const logo = websiteConfig.metadata?.images?.logoLight;
  return {
    '@type': 'Organization',
    '@id': `${url}#organization`,
    name: websiteConfig.metadata?.name ?? '',
    url,
    ...(logo && { logo: getImageUrl(logo) }),
    sameAs: Object.values(websiteConfig.social ?? {}).filter(
      (value): value is string => typeof value === 'string' && !!value
    ),
  };
}

const PUBLIC_PAGE_TYPES: Record<string, string> = {
  '/': 'WebPage',
  '/about': 'AboutPage',
  '/contact': 'ContactPage',
  '/blog': 'CollectionPage',
  '/changelog': 'CollectionPage',
  '/roadmap': 'WebPage',
  '/waitlist': 'WebPage',
  '/pricing': 'WebPage',
  '/ai': 'WebPage',
  '/privacy': 'WebPage',
  '/terms': 'WebPage',
  '/cookie': 'WebPage',
};

export function pageStructuredData(
  path: string,
  options: {
    url: string;
    title: string;
    description?: string;
    locale: Locale;
  }
) {
  const type =
    PUBLIC_PAGE_TYPES[path] ??
    (path.startsWith('/blog/') ? 'WebPage' : undefined);
  if (!type) return [];
  const home = getCanonicalUrlForLocale('/', options.locale);
  const organization = organizationStructuredData(options.locale);
  const website = {
    '@type': 'WebSite',
    '@id': `${home}#website`,
    url: home,
    name: websiteConfig.metadata?.name ?? '',
    description: websiteConfig.metadata?.description ?? '',
    inLanguage: localeConfig[options.locale].hreflang,
    publisher: { '@id': organization['@id'] },
  };
  return [
    jsonLdScript({
      '@context': 'https://schema.org',
      '@graph': [
        organization,
        website,
        {
          '@type': type,
          '@id': `${options.url}#webpage`,
          url: options.url,
          name: options.title,
          ...(options.description && { description: options.description }),
          inLanguage: localeConfig[options.locale].hreflang,
          isPartOf: { '@id': website['@id'] },
          ...(path === '/about' && { about: { '@id': organization['@id'] } }),
        },
      ],
    }),
  ];
}
