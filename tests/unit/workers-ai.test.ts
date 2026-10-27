import { describe, expect, it } from 'vitest';
import { base64ImageUrl, chatText } from '@/lib/workers-ai';

describe('Workers AI response formats', () => {
  it('extracts OpenAI-compatible text and tolerates empty output', () => {
    expect(chatText({ choices: [{ message: { content: 'Summary' } }] })).toBe(
      'Summary'
    );
    expect(chatText({ choices: [] })).toBe('');
    expect(chatText({ response: 'Legacy response' })).toBe('Legacy response');
  });
  it('preserves image MIME types across model and upload formats', () => {
    expect(base64ImageUrl('iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    );
    expect(base64ImageUrl('/9j/AA==')).toBe('data:image/jpeg;base64,/9j/AA==');
    expect(base64ImageUrl('UklGRabc')).toBe('data:image/webp;base64,UklGRabc');
    expect(() => base64ImageUrl('unknown')).toThrow('Unsupported image format');
  });
});
