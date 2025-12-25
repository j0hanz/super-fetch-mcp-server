import { config } from '../../config/index.js';

export function sanitizeHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers || Object.keys(headers).length === 0) {
    return undefined;
  }

  const { blockedHeaders } = config.security;
  const normalized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (blockedHeaders.has(key.toLowerCase())) continue;
    try {
      normalized.set(key, value);
    } catch {
      continue;
    }
  }

  const entries = Array.from(normalized.entries());
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}
