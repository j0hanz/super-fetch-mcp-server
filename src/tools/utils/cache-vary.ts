import { config } from '../../config/index.js';

import { normalizeHeaderRecord } from '../../utils/header-normalizer.js';

function normalizeHeadersForCache(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  return normalizeHeaderRecord(headers, config.security.blockedHeaders, {
    trimValues: true,
  });
}

export function appendHeaderVary(
  cacheVary: Record<string, unknown> | string | undefined,
  customHeaders?: Record<string, string>
): Record<string, unknown> | string | undefined {
  const headerVary = normalizeHeadersForCache(customHeaders);
  return mergeCacheVary(cacheVary, headerVary);
}

function mergeCacheVary(
  cacheVary: Record<string, unknown> | string | undefined,
  headerVary: Record<string, string> | undefined
): Record<string, unknown> | string | undefined {
  if (!cacheVary && !headerVary) return undefined;
  if (typeof cacheVary === 'string') {
    return buildStringVary(cacheVary, headerVary);
  }
  return mergeObjectVary(cacheVary, headerVary);
}

function mergeObjectVary(
  cacheVary: Record<string, unknown> | undefined,
  headerVary: Record<string, string> | undefined
): Record<string, unknown> | undefined {
  if (!headerVary) return cacheVary;
  return { ...(cacheVary ?? {}), headers: headerVary };
}

function buildStringVary(
  key: string,
  headerVary: Record<string, string> | undefined
): Record<string, unknown> {
  if (!headerVary) return { key };
  return { key, headers: headerVary };
}
