import { z } from 'zod';

export const WEB_SEARCH_PROVIDERS = ['ceramic', 'exa', 'linkup'] as const;
export const webSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(1024),
  provider: z.enum(WEB_SEARCH_PROVIDERS),
});
export const webSearchResultSchema = z.object({
  items: z.array(
    z.object({
      url: z.url().refine((url) => /^https?:\/\//.test(url)),
      title: z.string(),
      description: z.string().optional(),
    })
  ),
  metadata: z.object({ latencyMs: z.number().optional() }).optional(),
});
export type WebSearchResult = z.infer<typeof webSearchResultSchema>;
