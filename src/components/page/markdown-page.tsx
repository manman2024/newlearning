import { Markdown } from '@/components/markdown/markdown';
import { Card, CardContent } from '@/components/ui/card';
import { localeConfig } from '@/lib/locale';
import type { PageDoc } from '@/lib/pages';
import type { MarkdownResult } from '@/lib/markdown';

export function MarkdownPage({
  page,
  markdown,
}: {
  page: PageDoc;
  markdown: MarkdownResult;
}) {
  const { title, description } = page;

  return (
    <div
      lang={localeConfig[page.locale].hreflang}
      className="mx-auto max-w-4xl space-y-8"
    >
      <div className="space-y-4">
        <h1 className="text-center text-3xl font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-center text-lg text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Card>
        <CardContent>
          <Markdown
            markup={markdown.markup}
            className="prose prose-neutral dark:prose-invert max-w-none"
          />
        </CardContent>
      </Card>
    </div>
  );
}
