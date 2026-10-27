import { m } from '@/locale/paraglide/messages';
import { HeaderSection } from '@/components/shared/header-section';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  IconBrandCloudflare,
  IconBrandGoogleFilled,
  IconBrandOpenai,
  IconBrandReact,
  IconBrandStripe,
  IconBrandTypescript,
  IconChevronRight,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
// Brand colors (visible on both light and dark backgrounds)
export const BRAND_COLORS = {
  openai: '#0d8c6c',
  stripe: '#635bff',
  cloudflare: '#f38020',
  react: '#149eca',
  typescript: '#3178c6',
  google: '#2a6fdb',
} as const;
function getItems(): Array<{
  title: string;
  description: string;
  icon: Icon;
  color: string;
  href: string;
}> {
  return [
    {
      title: m.home_integration_items_item_1_title(),
      description: m.home_integration_items_item_1_description(),
      icon: IconBrandOpenai,
      color: BRAND_COLORS.openai,
      href: 'https://openai.com',
    },
    {
      title: m.home_integration_items_item_2_title(),
      description: m.home_integration_items_item_2_description(),
      icon: IconBrandStripe,
      color: BRAND_COLORS.stripe,
      href: 'https://stripe.com',
    },
    {
      title: m.home_integration_items_item_3_title(),
      description: m.home_integration_items_item_3_description(),
      icon: IconBrandCloudflare,
      color: BRAND_COLORS.cloudflare,
      href: 'https://www.cloudflare.com',
    },
    {
      title: m.home_integration_items_item_4_title(),
      description: m.home_integration_items_item_4_description(),
      icon: IconBrandReact,
      color: BRAND_COLORS.react,
      href: 'https://react.dev',
    },
    {
      title: m.home_integration_items_item_5_title(),
      description: m.home_integration_items_item_5_description(),
      icon: IconBrandTypescript,
      color: BRAND_COLORS.typescript,
      href: 'https://www.typescriptlang.org',
    },
    {
      title: m.home_integration_items_item_6_title(),
      description: m.home_integration_items_item_6_description(),
      icon: IconBrandGoogleFilled,
      color: BRAND_COLORS.google,
      href: 'https://ai.google.dev',
    },
  ];
}
function IntegrationCard({
  title,
  description,
  icon: Icon,
  color,
  learnMore,
  href,
}: {
  title: string;
  description: string;
  icon: Icon;
  color: string;
  learnMore: string;
  href: string;
}) {
  const linkClasses = cn(
    buttonVariants({ variant: 'outline', size: 'sm' }),
    'gap-1 pr-2 shadow-none'
  );
  return (
    <Card className="bg-transparent p-6 transition-colors duration-200 hover:bg-accent dark:hover:bg-card">
      <div className="relative">
        <Icon className="size-10 shrink-0" style={{ color }} />

        <div className="space-y-2 py-6">
          <h3 className="text-base font-medium">{title}</h3>
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {description}
          </p>
        </div>

        <div className="flex gap-3 border-t border-dashed pt-6">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClasses}
          >
            {learnMore}
            <IconChevronRight className="ml-0 size-3.5 opacity-50" />
          </a>
        </div>
      </div>
    </Card>
  );
}
export default function IntegrationSection() {
  const items = getItems();
  return (
    <section id="integration" className="px-4 py-16 md:py-24">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <HeaderSection
            title={m.home_integration_title()}
            subtitle={m.home_integration_subtitle()}
            description={m.home_integration_description()}
          />
        </ScrollReveal>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <ScrollReveal key={item.title} delay={index * 80}>
              <IntegrationCard
                title={item.title}
                description={item.description}
                icon={item.icon}
                color={item.color}
                href={item.href}
                learnMore={m.home_integration_learn_more()}
              />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
