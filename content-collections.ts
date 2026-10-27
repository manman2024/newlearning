import { defineCollection, defineConfig } from '@content-collections/core';
import { z } from 'zod';
import type { localeConfig } from '@/lib/locale';

type ContentLocale = keyof typeof localeConfig;

const contentLocales = {
  en: true,
  zh: true,
} as const satisfies Record<ContentLocale, true>;

const defaultLocale: ContentLocale = 'en';

const localeSuffix = new RegExp(
  `^(?<slug>.+)\\.(?<locale>${Object.keys(contentLocales).join('|')})$`
);

function isContentLocale(value: string): value is ContentLocale {
  return Object.hasOwn(contentLocales, value);
}

function getLocaleSlug(path: string): {
  locale: ContentLocale;
  slug: string;
} {
  const localeMatch = path.match(localeSuffix);
  const locale = localeMatch?.groups?.locale;
  const slug = localeMatch?.groups?.slug;
  if (locale && slug && isContentLocale(locale)) {
    return { locale, slug };
  }
  return { locale: defaultLocale, slug: path };
}

const blog = defineCollection({
  name: 'blog',
  directory: 'content/blog',
  include: '**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    category: z.string(),
    content: z.string(),
    image: z.string().min(1),
  }),
  transform: (doc) => {
    const { locale, slug } = getLocaleSlug(
      (doc as { _meta: { path: string } })._meta.path
    );
    return { ...doc, locale, slug };
  },
});

const pages = defineCollection({
  name: 'pages',
  directory: 'content/pages',
  include: '**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string().optional(),
    content: z.string(),
  }),
  transform: (doc) => {
    const { locale, slug } = getLocaleSlug(
      (doc as { _meta: { path: string } })._meta.path
    );
    return { ...doc, locale, slug };
  },
});

const changelog = defineCollection({
  name: 'changelog',
  directory: 'content/changelog',
  include: '**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    version: z.string(),
    published: z.boolean().default(true),
    content: z.string(),
  }),
  transform: (doc) => {
    const { locale, slug } = getLocaleSlug(
      (doc as { _meta: { path: string } })._meta.path
    );
    return { ...doc, locale, slug };
  },
});

export default defineConfig({
  collections: [blog, pages, changelog],
});
