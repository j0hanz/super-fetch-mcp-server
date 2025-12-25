import { config } from '../../config/index.js';

function sanitizeHeaderValue(value: string): string {
  return value.trim();
}

export function normalizeHeadersForCache(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers || Object.keys(headers).length === 0) {
    return undefined;
  }

  const { blockedHeaders } = config.security;
  const normalized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (blockedHeaders.has(lowerKey)) continue;
    try {
      normalized.set(key, sanitizeHeaderValue(value));
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

export function appendHeaderVary(
  cacheVary: Record<string, unknown> | string | undefined,
  customHeaders?: Record<string, string>
): Record<string, unknown> | string | undefined {
  const headerVary = normalizeHeadersForCache(customHeaders);

  if (!cacheVary && !headerVary) {
    return undefined;
  }

  if (typeof cacheVary === 'string') {
    return headerVary
      ? { key: cacheVary, headers: headerVary }
      : { key: cacheVary };
  }

  return headerVary ? { ...(cacheVary ?? {}), headers: headerVary } : cacheVary;
}
