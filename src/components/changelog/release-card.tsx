import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Markdown } from '@/components/markdown/markdown';
import { formatDate } from '@/lib/formatter';
import type { ChangelogRelease } from '@/lib/changelog';
import type { MarkdownResult } from '@/lib/markdown';
import { IconCalendar, IconTag } from '@tabler/icons-react';

interface ReleaseCardProps {
  release: ChangelogRelease;
  markdown: MarkdownResult;
}

export function ReleaseCard({ release, markdown }: ReleaseCardProps) {
  const formattedDate = formatDate(new Date(release.date));

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold tracking-tight">{release.title}</h2>
          <Badge variant="default" className="w-fit">
            <IconTag className="mr-1 size-3" aria-hidden="true" />
            {release.version}
          </Badge>
        </div>
        <p className="text-muted-foreground">{release.description}</p>
        <div className="flex items-center gap-2">
          <IconCalendar
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <time
            dateTime={release.date}
            className="text-sm text-muted-foreground"
          >
            {formattedDate}
          </time>
        </div>
        <Separator />
      </CardHeader>
      <CardContent>
        <Markdown
          markup={markdown.markup}
          className="prose prose-neutral dark:prose-invert max-w-none"
        />
      </CardContent>
    </Card>
  );
}
