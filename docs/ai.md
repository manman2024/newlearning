# AI module

End-to-end AI playground showcasing how to integrate **Cloudflare Workers AI** and **fal.ai** in a TanStack Start + Cloudflare Workers app. All demos run as TanStack server functions (`createServerFn`) calling the Workers AI / Web Search REST APIs or the `@tanstack/ai` + `@tanstack/ai-fal` adapter, with simple React cards as the UI.

The whole playground lives at **`/ai`** page and is reachable from the navbar **AI** dropdown menus. Each demo is a self-contained card so you can copy any single piece into your own project.

---

## Directory structure

```
src/api/
└── ai.ts                       # 10 server functions + helpers (runWorkersAi, parseTaglines, base64 utils)

src/lib/
├── clef.ts                    # Typed decision questions and response validation
├── workers-ai.ts              # Chat response parsing and image MIME helpers
└── web-search.ts              # Search providers and validation

src/config/
└── ai-models.ts                # Central model IDs shared by server functions and UI cards

src/routes/(pages)/
└── ai.tsx                      # Page that mounts each card inside <section id="..."> for hash-anchor nav

src/components/ai/
├── ai-web-search-card.tsx      # Web search (Ceramic.ai / Exa / Linkup)
├── ai-decision-card.tsx        # Support-ticket decisions (Clef / Clef Flash)
├── ai-summarization-card.tsx   # Text summarization (Gemma 4 chat)
├── ai-translation-card.tsx     # Translation (m2m100, 10 languages)
├── ai-tagline-card.tsx         # Tagline generator (Gemma 4 chat)
├── ai-tts-card.tsx             # Text-to-speech (Deepgram Aura, 8 voices)
├── ai-caption-card.tsx         # Image-to-text captioning (Gemma 4)
├── ai-cf-image-card.tsx        # Text-to-image · Workers AI (FLUX.2 / FLUX.1)
├── ai-image-card.tsx           # Text-to-image · fal.ai (Gemini / Flux / GPT Image 2)
└── ai-image-edit-card.tsx      # Image-to-image · fal.ai Gemini edit (Avatar Stylizer)
```

---

## Configuration

| Source | Key | Description |
|--------|-----|-------------|
| Env var | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID — used for all Workers AI REST calls. |
| Env var | `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Workers AI: Read** permission. Used for decisions, summarization, translation, tagline, TTS, captioning, CF image gen. Web search also requires **AI Gateway: Read**. |
| Env var | `FAL_KEY` | fal.ai API key. Used for text-to-image (Gemini / Flux / GPT Image 2) and image-to-image (Gemini edit). |

All three are read in `src/env/server.ts` (Zod-validated via `@t3-oss/env-core`) and accessed inside server functions through `serverEnv`.

> There is **no** Workers AI binding in `wrangler.jsonc` — every Workers AI call goes through the public REST endpoint so the same code works in CI / external runtimes too. Set the secrets with `wrangler secret put CLOUDFLARE_ACCOUNT_ID` (etc.) in production.

Web search additionally requires AI Gateway credits or a provider key stored
on the `default` Gateway. It reuses the existing Cloudflare credentials.

---

## Architecture

Every demo follows the same shape:

```
Browser (card) ──▶ TanStack server function ──▶ provider API ──▶ response
                  (createServerFn + Zod)         (Workers AI REST | fal adapter)
```

- **Validation** — every server function uses `.validator(zodSchema)` for both type safety and runtime validation (max prompt length, file size cap, language enum, model enum, …).
- **No auth, no rate limit** — none of the functions uses `.middleware()`, and the `/ai` route has no guard. Any anonymous visitor can call the paid Workers AI and fal.ai endpoints; add `authApiMiddleware` or a rate limiter if you deploy these demos publicly.
- **Model IDs** — runtime model IDs are centralized in `src/config/ai-models.ts` and imported by both server functions and UI cards. The translation language list is defined in both the server schema and card. TTS speaker IDs are shared from `src/config/ai-models.ts`.
- **Workers AI helper** — `runWorkersAi<TResult>(model, body)` in `src/api/ai.ts` wraps the common JSON request flow (auth headers, `success` / `errors` envelope) so each demo only declares its model + payload.
- **Chat responses** — Gemma 4 demos disable thinking for short responses and read `choices[0].message.content` via `chatText()` in `src/lib/workers-ai.ts`.
- **Binary responses** — TTS (`audio/mpeg`) and CF image gen (binary `image/*`) bypass `runWorkersAi` and base64-encode the body via `arrayBufferToBase64()` so the result can be returned as a `data:` URL the browser renders directly.
- **Image bytes in / out** — captioning and image-edit accept the user's upload as a base64 string, forwarded as MIME-aware `data:` URLs in multimodal messages (Gemma 4) or image URLs (fal).
- **Client downloads** — image cards use `downloadFile()` from `src/lib/download.ts`, which fetches the image into a blob (handles CORS for fal CDN URLs) before clicking a hidden `<a download>` link, so the browser actually saves the file instead of navigating.

---

## Server functions (`src/api/ai.ts`)

| Export | Provider · Model | Input | Output |
|--------|------------------|-------|--------|
| **searchWeb** | Web Search · Ceramic.ai / Exa / Linkup | `query` (1–1024 trimmed chars), `provider` (enum) | `{ items, metadata? }` (up to five results) |
| **evaluateTicket** | Workers AI · `@cf/cloudflare/clef` / `@cf/cloudflare/clef-flash` | `state` (10–4000 trimmed chars), `model` (enum) | `{ model, answers, usage }` (validated typed decisions) |
| **summarizeText** | Workers AI · `@cf/google/gemma-4-26b-a4b-it` (chat) | `text` (50–500 chars) | `{ summary }` |
| **translateText** | Workers AI · `@cf/meta/m2m100-1.2b` | `text` (1–1000 chars), `sourceLang`, `targetLang` (10-language enum) | `{ translatedText }` |
| **generateTaglines** | Workers AI · `@cf/google/gemma-4-26b-a4b-it` (chat) | `product` (10–400 chars) | `{ taglines: string[] }` (parsed numbered list) |
| **synthesizeSpeech** | Workers AI · `@cf/deepgram/aura-2-en` | `text` (1–1000 chars), `speaker` (8 voices) | `{ audioUrl, bytes }` (`data:audio/mpeg;base64,...`) |
| **captionImage** | Workers AI · `@cf/google/gemma-4-26b-a4b-it` | `imageBase64` (100–1.4M chars), `prompt` (1–300 chars) | `{ description }` |
| **generateCfImage** | Workers AI · FLUX.2 Klein 4B / Klein 9B / FLUX.1 Schnell | `prompt` (10–500 chars), `model` (enum) | `{ imageUrl, model }` (`data:image/...;base64,...`) |
| **generateAiImage** | fal.ai · Nano Banana / Flux Schnell / GPT Image 2 | `prompt` (10–500 chars), `model` (enum) | `{ imageUrl, model }` (fal CDN URL) |
| **editAiImage** | fal.ai · `fal-ai/nano-banana/edit` | `imageBase64` (100–1.4M chars), `prompt` (5–500 chars) | `{ imageUrl }` |

The server-side image cap is a base64 **string length** limit (1,400,000 characters, ≈1.05 MB decoded). The cards enforce a separate 1,000,000-byte file cap on the client before upload, so the card limit applies first.

All functions throw a descriptive `Error` on missing env, non-2xx responses, or empty payloads — the cards surface the message in the result panel.

---

## The demos

The page renders one section per demo, each wrapped in `<section id="...">` so the AI navbar dropdown can deep-link with hash anchors (e.g. `/ai#tagline-generator`).

### 1. Web Search
**Card:** `AiWebSearchCard` · **Providers:** Ceramic.ai (default), Exa, Linkup

At `/ai#web-search`, choose a provider and enter a query or load a travel,
English-learning or dinner example. `searchWeb` calls the Web Search REST API
through the `default` AI Gateway. Results show numbered titles and source links.

### 2. Decision
**Card:** `AiDecisionCard` · **Models:** `@cf/cloudflare/clef` / `@cf/cloudflare/clef-flash` (Workers AI)

At `/ai#decision-model`, choose a model, load an outage/refund/upgrade example,
or edit the support ticket (10–4000 trimmed characters). `evaluateTicket` sends
`model`, `state`, and three fixed typed questions through `runWorkersAi`.

The three numbered result cards demonstrate `noul` (urgency probability),
`choice` (responsible team and per-option probabilities), and `score` (weighted
customer impact from 0 to 3 with per-level probabilities). The schema and
response validation live in `src/lib/clef.ts`. Results illustrate predictions;
submitting a ticket does not route it or perform automated actions. Local
functional tests mock failures; real provider verification is separate.

API reference: [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)
and [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/).

### 3. Text Summarization
**Card:** `AiSummarizationCard` · **Model:** `@cf/google/gemma-4-26b-a4b-it` (Workers AI)

Paste a long article (50–500 chars), get a concise summary back. Demonstrates a single-shot chat call with `messages: [{ role, content }]` and a system prompt that constrains the response to summary text only.

### 4. Translation
**Card:** `AiTranslationCard` · **Model:** `@cf/meta/m2m100-1.2b` (Workers AI)

Many-to-many multilingual translation across 10 languages with a swap button. Shows how to declare a `z.enum(...)` schema for both source and target language and a `.refine()` rule preventing same-language translation.

### 5. Tagline Generator (Chat)
**Card:** `AiTaglineCard` · **Model:** `@cf/google/gemma-4-26b-a4b-it` (Workers AI)

Single-shot chat call with a system prompt that constrains output to a numbered list of 5 taglines. Shows how to call instruct chat models with `messages: [{ role, content }]` and parse semi-structured text back into JSON via `parseTaglines()`.

### 6. Text to Speech
**Card:** `AiTtsCard` · **Model:** `@cf/deepgram/aura-2-en` (Workers AI)

8 selectable Aura 2 English voices (Asteria, Luna, Athena, Hera, Arcas, Orion, Orpheus, Zeus). Returns binary MP3 (`Content-Type: audio/mpeg`) which is base64-encoded server-side and served as a `data:audio/mpeg;base64,...` URL into a native `<audio controls>`. Includes a per-character cost preview ($0.03 / 1K chars).

### 7. Image Captioning
**Card:** `AiCaptionCard` · **Model:** `@cf/google/gemma-4-26b-a4b-it` (Workers AI)

Upload a portrait or photo (≤1 MB), pick a prompt preset (caption / detailed description / 5 keywords / objects list) or write your own, and get a description back. The image signature determines its PNG/JPEG/WebP MIME type. The data URL and prompt are sent as multimodal messages; the response is read from `choices[0].message.content`.

### 8. Image Generator · Workers AI
**Card:** `AiCfImageCard` · **Models:**
- `@cf/black-forest-labs/flux-2-klein-4b` (default, fast generation)
- `@cf/black-forest-labs/flux-2-klein-9b` (larger model)
- `@cf/black-forest-labs/flux-1-schnell` (previous-generation alternative)

FLUX.2 uses multipart form data with `prompt`, `width` and `height` (1024).
FLUX.1 uses JSON input. Both return base64 images; the encoded signature
selects the correct image MIME type. The helper also supports binary responses.

### 9. Image Generator · fal.ai
**Card:** `AiImageCard` · **Models:**
- `fal-ai/nano-banana` (default — Google "Nano Banana", ~$0.039 / image)
- `fal-ai/flux/schnell` (fast & cheap — ~$0.003 / image)
- `openai/gpt-image-2` (premium — sharp text & photoreal; forced to `quality: 'low'` + `output_format: 'jpeg'` so it finishes in ~30 s within Cloudflare's subrequest budget)

Uses the `@tanstack/ai` + `@tanstack/ai-fal` adapter via `falImage(model, { apiKey })` and `generateImage({ adapter, prompt })`. The adapter polls fal's queue under the hood. Returns the fal-hosted CDN URL.

### 10. Avatar Stylizer (image-to-image)
**Card:** `AiImageEditCard` · **Model:** `fal-ai/nano-banana/edit` (fal.ai)

Upload a portrait, pick a style preset (Bobblehead Caricature / Pixar 3D / Anime Portrait) or write a custom prompt, get an identity-preserving stylized version back. Implementation passes the user image as a base64 `data:` URI inside `modelOptions.image_urls` — fal accepts data URIs natively, so no separate upload step is required.

Each preset prompt explicitly tells the model to *keep the original facial features recognizable* so the stylization survives the round-trip.

---

## Adding a new demo

1. **Server function** — add to `src/api/ai.ts`:
   - Declare a Zod schema for the input.
   - For Workers AI JSON models: call `runWorkersAi<TResult>(model, body)`.
   - For Workers AI binary endpoints: `fetch()` directly and base64-encode the buffer.
   - For fal.ai: `falImage(model, { apiKey: serverEnv.FAL_KEY })` + `generateImage({ adapter, prompt, modelOptions })`.
2. **Card** — create `src/components/ai/ai-<name>-card.tsx` matching the existing layout (`Card` → header with title + `<code>` model id + description, `CardContent` with two-column grid). Reuse `downloadFile()` for any image / audio result.
3. **Mount** — add `<section id="...">` to `src/routes/(pages)/ai.tsx`.
4. **Navbar** — add a `Routes.Ai<Name>` entry in `src/lib/routes.ts`, add flat `nav_ai_<name>_*` keys in both locale JSON files, then push a sub-item to the AI dropdown in `src/config/navbar-config.ts` with an icon.

---

## Dependencies

- **`@tanstack/ai`**, **`@tanstack/ai-fal`** — image generation adapter for fal.ai (used by `generateAiImage` and `editAiImage`).
- **`@fal-ai/client`** — transitive dependency of `@tanstack/ai-fal`; queues + polls fal jobs.
- **`@tanstack/ai-react`** — declared as a dependency but currently unused in `src/`; kept for chat-style integrations.

No Cloudflare AI binding is required (`AI` was removed from `wrangler.jsonc`) — every Workers AI call uses the REST API.
