import { HomePage } from '@/components/blocks/homepage';
import { websiteConfig } from '@/config/website';
import { seo } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  head: () => {
    const title = websiteConfig.metadata?.title ?? '';
    const description = websiteConfig.metadata?.description ?? '';
    const metadata = seo('/', { title, description });
    return metadata;
  },
  component: HomePage,
});
