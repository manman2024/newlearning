export type WorkersAiChatResult = {
  response?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
};

export function chatText(result: WorkersAiChatResult): string {
  return result.choices?.[0]?.message?.content ?? result.response ?? '';
}

/** Infer the MIME type from the encoded signature, without Node APIs. */
export function base64ImageUrl(base64: string): string {
  const mime = base64.startsWith('iVBOR')
    ? 'image/png'
    : base64.startsWith('/9j/')
      ? 'image/jpeg'
      : base64.startsWith('UklGR')
        ? 'image/webp'
        : undefined;
  if (!mime)
    throw new Error('Unsupported image format. Use PNG, JPEG, or WebP.');
  return `data:${mime};base64,${base64}`;
}
