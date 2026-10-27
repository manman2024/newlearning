# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary audience:** indie hackers and solo founders building SaaS products on Cloudflare Workers. They are technically proficient developers who value speed, efficiency, and clean tooling. They use this boilerplate to skip setup and ship revenue-generating products faster. Their context is focused productivity — they want to configure, customize, and deploy without friction.

## Product Purpose

TanStarter is the complete TanStack Start boilerplate for building profitable SaaS, packed with AI, auth, database, storage, blog, email, newsletter, payments, dashboard, i18n, SEO, and more, fully deployed on Cloudflare Workers. Success means a buyer goes from clone to a working, revenue-capable SaaS running on Cloudflare Workers with minimal setup time and predictable low cost.

## Positioning

“Ship Faster with TanStack, Cost Less with Cloudflare.” The mechanism a neighboring boilerplate could not truthfully copy: a full-stack TanStack Start + React 19 SaaS with auth (Better Auth), payments (Stripe/Creem/Waffo), storage (R2), mail, newsletter, blog, dashboard, admin, i18n, and SEO that runs as a single Cloudflare Worker with D1/R2/KV — batteries included, no server to operate, and Workers-scale cost.

## Operating Context

- Buyer workflow: start at the docs site, clone or generate from the template, configure `.env` (build-time `VITE_` client vars; runtime server bindings/secrets), run `pnpm dev` on port 3000, customize `src/config/website.ts`, apply D1 migrations with `pnpm db:migrate:local|remote`, and ship with `pnpm deploy`.
- Supporting surfaces: website tanstarter.dev, demo demo.tanstarter.dev, docs docs.tanstarter.dev, video tutorials on YouTube (@TanStarter), Discord community (mksaas.link/discord), support at support@tanstarter.dev.
- Quality workflow: local-first Playwright E2E under `tests/e2e/` with the acceptance checklist in TEST-CATALOG.md; `pnpm check` runs complete local validation; `pnpm check:production` separately runs production-mode Worker smoke tests in local preview. Neither command deploys or tests a live site. The E2E helper API only works in local Vite DEV with `MODE=e2e` and a matching secret.
- The template is the upstream for the MkFastHQ product family; sibling checkouts (e.g. mkfast-app, mkfast-website) sync from it while preserving their own branding and product behavior.

## Capabilities and Constraints

Confirmed capabilities:

- Auth: Better Auth — email/password, Google OAuth, API keys, admin roles, user banning, delete account.
- Payments: Stripe, Creem, or Waffo selected by `VITE_PAYMENT_PROVIDER`; plans Free, Pro ($9.90/month or $99/year), Lifetime ($199 one-time); checkout, billing portal, and webhooks.
- Mail: Resend or Cloudflare Email behind a provider abstraction, with React Email templates.
- Newsletter: Resend or Beehiiv; waitlist page; auto-subscribe after sign-up.
- Storage: Cloudflare R2 user files with configured allowed types and size limits.
- AI playground: Cloudflare Workers AI (REST) and fal.ai — text summarization, translation, tagline generation, text-to-speech, image captioning, and image generation/editing.
- Blog: Content Collections (markdown), English/Chinese content, pagination.
- Dashboard and admin: dashboard stats and charts; settings for profile, security, API keys, files, billing, payment, and notifications; admin user management with a detail drawer.
- i18n: Paraglide with English and Chinese, URL-based locale strategy.
- SEO: sitemap, robots.txt, web manifest, and OG image.
- Extras: Cloudflare KV cache, Discord/Feishu webhook notifications, Crisp chat, and Plausible/GA/Umami/Clarity analytics via env vars.

Confirmed constraints:

- Runs on the Cloudflare Workers runtime: no Node.js-specific APIs. Bindings are `DB` (D1), `BUCKET` (R2), and `CACHE` (KV); schemas use Drizzle.
- Client env vars use the `VITE_` prefix (build-time); server env is validated at runtime with Zod via `@t3-oss/env-core`.
- File-based routing under `src/routes/`; `src/routeTree.gen.ts` is auto-generated and must never be edited.
- The LICENSE is a custom TanStarter License (not OSI/MIT): unlimited end products including client work and resale, but no redistribution of template components separately and no competing starter kits; governed by Swiss law, revocable on material breach, liability limited to license fee.
- Biome-enforced style: 2-space indent, 80-char line width, single quotes, semicolons; linting excludes `src/components/ui/`, `src/components/data-table/`, `src/db/`, and generated route tree.

## Brand Commitments

- Name: TanStarter. Tagline: “Ship Faster with TanStack, Cost Less with Cloudflare.”
- Created by Fox (@indie_maker_fox), founder of TanStarter, MkImage, MkSaaS, and Mkdirs; distributed under the MkFastHQ GitHub org.
- Public surfaces: tanstarter.dev, demo.tanstarter.dev, docs.tanstarter.dev, YouTube @TanStarter, Discord, support@tanstarter.dev, X @TanStarter.
- Identity commitments recorded in `docs/design.md`: brand personality Modern / Professional / Technical; voice direct, confident, and understated; dark-first, ultra-minimal achromatic visual system with a single amber accent and Bricolage Grotesque; design references Linear, Vercel, Raycast, and Stripe; explicitly avoids playful/cartoonish, enterprise-heavy, cluttered, and generic Bootstrap-style designs.
- Asset names are binding: `/logo.png`, `/logo-dark.png`, `/og.png`, plus favicon set in `public/`.

## Evidence on Hand

- README.md — positioning, author, links, community, language policy for issues.
- docs/design.md — the recorded visual world (dark-first achromatic minimalism, typography, shape, references, anti-references, accessibility principles).
- docs/ — module docs for ai, auth, cache, db, design, env, locale, mail, newsletter, notification, payment, storage.
- src/config/website.ts — feature flags, providers, pricing, metadata, social links.
- project.inlang/messages/en.json and zh.json — full site copy in English and Chinese.
- content/ — blog posts, changelog, and legal pages in en/zh.
- tests/e2e/TEST-CATALOG.md and specs — the acceptance journeys and E2E coverage.
- public/ — logo.png, logo-dark.png, og.png, tanstarter.png, favicon set.
- LICENSE — the TanStarter License terms.

Absent: no customer testimonials, case studies, revenue figures, or benchmark data exist in the repository. Homepage testimonial/stats copy is demo content and must not be treated as real evidence.

## Product Principles

1. **Time-to-revenue is the metric.** Every built-in capability exists to shorten the path from idea to a paid, deployed SaaS.
2. **One deployable Worker.** The full stack should stay within Cloudflare Workers plus D1/R2/KV; avoid patterns that demand heavier infrastructure.
3. **Production-ready defaults.** Auth, payments, email, storage, admin, SEO, and i18n work out of the box, with local-first E2E verification before release.
4. **Owned, not locked in.** Provider abstractions and standard tools (Drizzle, Better Auth, TanStack, shadcn/ui) let buyers swap pieces and keep ownership of their product.
5. **Developer-grade clarity.** Code, docs, and UX speak precisely to technical users — no fluff, no unnecessary abstraction.

## Accessibility & Inclusion

- docs/design.md commits to WCAG 2.1 AA, visible focus indicators, keyboard navigability, and sufficient contrast in both themes.
- The UI ships dark, light, and system modes (dark-first) and is localized in English and Chinese via Paraglide.
- No other product-specific accessibility requirements have been established.
