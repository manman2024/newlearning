import { m } from '@/locale/paraglide/messages';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import Container from '@/components/layout/container';
import { Markdown } from '@/components/markdown/markdown';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getPostBySlug, getPostLocales } from '@/lib/blog';
import { renderMarkdown } from '@/lib/markdown';
import { websiteConfig } from '@/config/website';
import { getCanonicalUrlForLocale, getImageUrl } from '@/lib/urls';
import { localeConfig } from '@/lib/locale';
import {
  jsonLdScript,
  organizationStructuredData,
} from '@/lib/structured-data';
import { seo } from '@/lib/seo';
import { IconArrowLeft } from '@tabler/icons-react';
import { formatDate } from '@/lib/formatter';

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    const markdown = await renderMarkdown(post.content);
    return { ...post, markdown };
  },
  head: ({ loaderData, params }) => {
    const post = loaderData;
    if (!post) return {};
    const path = `/blog/${params.slug}`;
    const title = `${post.title} | ${websiteConfig.metadata?.name}`;
    const description =
      post.description ?? websiteConfig.metadata?.description ?? '';
    const image = post.image ? getImageUrl(post.image) : undefined;
    const canonicalUrl = getCanonicalUrlForLocale(path, post.locale);
    const metadata = seo(path, {
      title,
      description,
      image,
      type: 'article',
      canonicalLocale: post.locale,
      alternateLocales: getPostLocales(params.slug),
    });
    const articleJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description,
      inLanguage: localeConfig[post.locale].hreflang,
      ...(image && { image }),
      datePublished: new Date(post.date).toISOString(),
      url: canonicalUrl,
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': `${canonicalUrl}#webpage`,
      },
      author: organizationStructuredData(post.locale),
      publisher: organizationStructuredData(post.locale),
    };
    return {
      ...metadata,
      scripts: [...metadata.scripts, jsonLdScript(articleJsonLd)],
    };
  },
  component: BlogPostPage,
});

function BlogPostPage() {
  const post = Route.useLoaderData();
  if (!post || !websiteConfig.blog?.enable) throw notFound();
  return (
    <Container className="py-16 px-4">
      <div className="mx-auto max-w-4xl">
        <Button
          variant="outline"
          size="sm"
          className="mb-6"
          nativeButton={false}
          render={<Link to="/blog" search={{ page: 1 }} />}
        >
          <IconArrowLeft className="size-4" aria-hidden="true" />
          {m.blog_all_posts()}
        </Button>

        <Card className="px-5 py-8 md:px-10 md:py-12">
          <article lang={localeConfig[post.locale].hreflang}>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
              <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium capitalize">
                {post.category}
              </span>
              <time dateTime={post.date}>
                {formatDate(new Date(post.date))}
              </time>
            </div>

            <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>

            {post.description && (
              <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
                {post.description}
              </p>
            )}

            <div className="mt-6 pt-10 border-t border-border">
              <Markdown
                markup={post.markdown.markup}
                className="prose prose-neutral dark:prose-invert max-w-none"
              />
            </div>
          </article>
        </Card>
      </div>
    </Container>
  );
}
