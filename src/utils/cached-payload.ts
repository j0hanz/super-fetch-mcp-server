import { isRecord } from './guards.js';

export interface CachedPayload {
  content?: string;
  markdown?: string;
  title?: string;
}

export function parseCachedPayload(raw: string): CachedPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCachedPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveCachedPayloadContent(
  payload: CachedPayload
): string | null {
  if (typeof payload.markdown === 'string') {
    return payload.markdown;
  }
  if (typeof payload.content === 'string') {
    return payload.content;
  }
  return null;
}

function hasOptionalStringProperty(
  value: Record<string, unknown>,
  key: string
): boolean {
  const prop = value[key];
  if (prop === undefined) return true;
  return typeof prop === 'string';
}

function isCachedPayload(value: unknown): value is CachedPayload {
  if (!isRecord(value)) return false;
  if (!hasOptionalStringProperty(value, 'content')) return false;
  if (!hasOptionalStringProperty(value, 'markdown')) return false;
  if (!hasOptionalStringProperty(value, 'title')) return false;
  return true;
}
