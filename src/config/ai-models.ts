export const WORKERS_AI_MODELS = {
  summarization: '@cf/google/gemma-4-26b-a4b-it',
  tagline: '@cf/google/gemma-4-26b-a4b-it',
  translation: '@cf/meta/m2m100-1.2b',
  textToSpeech: '@cf/deepgram/aura-2-en',
  imageCaption: '@cf/google/gemma-4-26b-a4b-it',
} as const;

export const CF_IMAGE_MODELS = [
  '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/black-forest-labs/flux-2-klein-9b',
  '@cf/black-forest-labs/flux-1-schnell',
] as const;

export const DEFAULT_CF_IMAGE_MODEL = CF_IMAGE_MODELS[0];

export const FAL_IMAGE_MODELS = [
  'fal-ai/flux/schnell',
  'fal-ai/nano-banana',
  'openai/gpt-image-2',
] as const;

export const DEFAULT_FAL_IMAGE_MODEL = 'fal-ai/nano-banana';
export const FAL_IMAGE_EDIT_MODEL = 'fal-ai/nano-banana/edit';
export const OPENAI_IMAGE_MODEL = 'openai/gpt-image-2';

export const CLEF_MODELS = ['clef', 'clef-flash'] as const;

export const TTS_SPEAKERS = [
  'asteria',
  'luna',
  'athena',
  'hera',
  'arcas',
  'orion',
  'orpheus',
  'zeus',
] as const;
