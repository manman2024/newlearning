## Design Context

### Users

**Primary audience:** Indie hackers and solo founders building SaaS products on Cloudflare Workers. They are technically proficient developers who value speed, efficiency, and clean tooling. They use this boilerplate to skip setup and ship revenue-generating products faster. Their context is focused productivity — they want to configure, customize, and deploy without friction.

### Brand Personality

**Three words:** Modern, Professional, Technical

**Voice & tone:** Direct, confident, and understated. No marketing fluff or unnecessary embellishment. Communicate with the precision developers expect. Every word earns its place.

**Emotional goals:**
- **Confidence & trust** — The interface should feel solid, reliable, and production-ready
- **Speed & efficiency** — Every interaction should feel fast and purposeful
- **Calm focus** — Distraction-free, letting the content and functionality lead
- **Technical credibility** — Developer-grade seriousness without being cold
- **Subtle delight** — Small moments of polish that reward attention to detail

### Aesthetic Direction

**Visual tone:** Ultra-minimal. Achromatic neutrals (chroma 0 in oklch) with a single amber accent; decorative color is limited to low-opacity amber/ochre gradients. Dark mode is the default and primary experience. Surfaces are flat with minimal elevation — prefer subtle rings and translucent borders over shadows. Density is compact, respecting screen real estate.

**Typography:** Bricolage Grotesque, body text at regular weight (400). A distinctive but professional grotesque sans-serif that adds just enough personality without being distracting. Bold (700) for headings. The shipped `@font-face` files are 400, 600, and 700 only; `font-medium` (500, used by components such as the default Button) is synthesized by the browser.

**Shape language:** Moderately rounded (10px base radius, `--radius: 0.625rem`). Not pill-shaped, not sharp — balanced and quiet.

**Color philosophy:** Achromatic grayscale in oklch color space with one amber primary (oklch 0.553 0.195 38.402) shared by both themes. Chroma is reserved for the primary accent, the slightly different sidebar amber (`--sidebar-primary`), functional states (destructive red), chart hues, and low-opacity warm gradients. The restraint of the neutrals is the brand, and the amber is earned rather than sprayed.

**Theme:** Dark-first with full light/dark/system support. Dark mode uses semi-transparent white borders for a subtle glassy depth effect.

**References (positive):**
- Linear — clean, fast, developer-focused
- Vercel — minimal, dark-first, professional
- Raycast — compact, keyboard-driven, polished
- Stripe — elegant, well-documented, trust-building

**Anti-references (explicitly avoid):**
- Overly playful/cartoon-like interfaces (e.g., Notion's illustrations)
- Enterprise/corporate heaviness (e.g., Salesforce, SAP)
- Cluttered dashboards with excessive data density
- Bland/generic Bootstrap-style templates

### Design Principles

1. **Content over chrome.** The interface should disappear. No decorative elements, no gratuitous color — the amber accent earns its place or disappears. Every pixel serves a purpose.

2. **Quiet confidence.** The design should feel assured without being loud. Subtle polish (consistent spacing, precise alignment, smooth transitions) communicates quality better than bold visuals.

3. **Compact by default.** Respect the developer's screen. Use tight but breathable spacing. Default interactive elements at 32px height. Avoid bloated layouts.

4. **Dark-first, light-ready.** Design for dark mode first, then ensure light mode is equally refined. Use translucent borders and subtle depth cues that work in both themes.

5. **Accessible without compromise.** Meet WCAG 2.1 AA standards. Ensure sufficient contrast ratios, visible focus indicators (ring-3), and keyboard navigability throughout. Accessibility is not an afterthought — it's built into every component.

### Technical Design Stack

- **CSS Framework:** Tailwind CSS v4 with oklch color tokens
- **Component Library:** shadcn/ui (base-nova style) + Base UI React primitives
- **Variant System:** class-variance-authority (CVA) + clsx + tailwind-merge
- **Icons:** Tabler Icons (`@tabler/icons-react`)
- **Animation:** tw-animate-css, plus custom entrance animations in `src/custom.css` (`fade-up`, `fade-in`, `crossfade-in`, `.delay-*`)
- **Font:** Bricolage Grotesque, Latin subset, self-hosted woff2 in `public/fonts/` (400, 600, 700) loaded with `font-display: optional` via `@font-face` in `src/styles.css`. The `@fontsource/bricolage-grotesque` package is installed but not imported.
- **Dark mode:** Class-based (`.dark` on `<html>`), localStorage-persisted
- **Color tokens:** oklch variables with the warm amber primary (`--primary`), a warm off-white primary foreground (`--primary-foreground`), and warm chart hues (`--chart-1..5`)
