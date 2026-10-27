/**
 * Lightweight observability logger for Cloudflare Workers.
 *
 * All error arguments are normalized to plain strings before output so raw
 * error objects (which may contain customer emails, payment details, or
 * provider secrets) are never serialized into logs.
 *
 * This module is the sanctioned logging boundary; every other module must
 * log through logOperationalEvent (enforced by noConsole in biome.json).
 */

// biome-ignore-all lint/suspicious/noConsole: sanctioned logging boundary.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function toSafeString(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  if (
    typeof value === 'object' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

function emit(level: LogLevel, event: string, details?: unknown): void {
  const parts = [`[${event}]`];
  if (details !== undefined) {
    parts.push(toSafeString(details));
  }
  const message = parts.join(' ');
  switch (level) {
    case 'debug':
      console.log(message);
      break;
    case 'info':
      console.info(message);
      break;
    case 'warn':
      console.warn(message);
      break;
    case 'error':
      console.error(message);
      break;
  }
}

export const logOperationalEvent = {
  /** Alias for info(); keeps mechanical migrations from console.log readable. */
  log: (event: string, details?: unknown) => emit('info', event, details),
  debug: (event: string, details?: unknown) => emit('debug', event, details),
  info: (event: string, details?: unknown) => emit('info', event, details),
  warn: (event: string, details?: unknown) => emit('warn', event, details),
  error: (event: string, details?: unknown) => emit('error', event, details),
};
