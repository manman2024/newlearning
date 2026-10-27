import { createFileRoute, notFound } from '@tanstack/react-router';
import Container from '@/components/layout/container';
import { MarkdownPage } from '@/components/page/markdown-page';
import { getPageBySlug, getPageLocales } from '@/lib/pages';
import { renderMarkdown } from '@/lib/markdown';
import { websiteConfig } from '@/config/website';
import { seo } from '@/lib/seo';

export const Route = createFileRoute('/(legals)/cookie')({
  loader: async () => {
    const page = getPageBySlug('cookie');
    if (!page) throw notFound();
    return { page, markdown: await renderMarkdown(page.content) };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.page;
    if (!p) return {};
    return seo('/cookie', {
      title: `${p.title} | ${websiteConfig.metadata?.name}`,
      description: p.description,
      canonicalLocale: p.locale,
      alternateLocales: getPageLocales('cookie'),
    });
  },
  component: CookiePage,
});

function CookiePage() {
  const { page, markdown } = Route.useLoaderData();
  if (!page) throw notFound();
  return (
    <Container className="py-16 px-4">
      <MarkdownPage page={page} markdown={markdown} />
    </Container>
  );
}
