import { z } from 'zod';

export const CLEF_TICKET_QUESTIONS = {
  urgent: {
    type: 'noul',
    instructions:
      'Does this request need immediate attention due to ongoing customer impact?',
  },
  team: {
    type: 'choice',
    instructions: 'Which team should handle this support request?',
    criteria: {
      billing: 'Invoices, refunds, and billing questions',
      technical: 'Outages, errors, and configuration',
      sales: 'Plans, upgrades, and purchasing',
    },
  },
  severity: {
    type: 'score',
    instructions: 'How severe is the current customer impact?',
    criteria: [
      'No impact',
      'Minor: workaround available',
      'Major: core functionality blocked for some users',
      'Critical: core functionality blocked for all users',
    ],
  },
} as const;

const probability = z.number().min(0).max(1);
export const clefTicketResultSchema = z.object({
  model: z.string(),
  answers: z.object({
    urgent: z.object({ type: z.literal('noul'), noul: probability }),
    team: z.object({
      type: z.literal('choice'),
      choice: z.enum(['billing', 'technical', 'sales']),
      probabilities: z.object({
        billing: probability,
        technical: probability,
        sales: probability,
      }),
      confidence: probability,
    }),
    severity: z.object({
      type: z.literal('score'),
      score: z.number().min(0).max(3),
      legend: z.record(z.string(), z.string()),
      probabilities: z.record(z.string(), probability),
      confidence: probability,
    }),
  }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});
export type ClefTicketResult = z.infer<typeof clefTicketResultSchema>;
