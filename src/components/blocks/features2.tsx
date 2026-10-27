import { m } from '@/locale/paraglide/messages';
import { HeaderSection } from '@/components/shared/header-section';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import {
  IconActivity,
  IconBolt,
  IconCompass,
  IconMail,
} from '@tabler/icons-react';
import { useResolvedTheme } from '@/components/theme/theme-provider';
export default function Features2Section() {
  const isDark = useResolvedTheme() === 'dark';

  return (
    <section id="features2" className="px-4 py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-2 lg:px-0 space-y-8 lg:space-y-20">
        <ScrollReveal>
          <HeaderSection
            title={m.home_features2_title()}
            subtitle={m.home_features2_subtitle()}
            description={m.home_features2_description()}
          />
        </ScrollReveal>

        <ScrollReveal delay={150}>
          <div className="grid items-center gap-12 lg:grid-cols-5 lg:gap-24">
            <div className="lg:col-span-2">
              <div className="lg:pr-0">
                <h2 className="text-4xl font-semibold">
                  {m.home_features2_title()}
                </h2>
                <p className="mt-6 text-muted-foreground">
                  {m.home_features2_description()}
                </p>
              </div>

              <ul className="mt-8 divide-y border-y *:flex *:items-center *:gap-3 *:py-3">
                <li>
                  <IconMail className="size-5 shrink-0" />
                  {m.home_features2_feature1()}
                </li>
                <li>
                  <IconBolt className="size-5 shrink-0" />
                  {m.home_features2_feature2()}
                </li>
                <li>
                  <IconActivity className="size-5 shrink-0" />
                  {m.home_features2_feature3()}
                </li>
                <li>
                  <IconCompass className="size-5 shrink-0" />
                  {m.home_features2_feature4()}
                </li>
              </ul>
            </div>

            <div className="relative rounded-3xl border border-border/50 p-3 lg:col-span-3">
              <div className="relative aspect-76/59 rounded-2xl bg-linear-to-b from-border to-transparent p-px">
                <img
                  src={isDark ? '/images/dark-card.webp' : '/images/card.webp'}
                  alt={m.block_features2_card_alt({
                    mode: isDark ? 'dark' : 'light',
                  })}
                  width={isDark ? 2400 : 2880}
                  height={isDark ? 1800 : 2074}
                  className="size-full rounded-[15px] object-cover shadow"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
