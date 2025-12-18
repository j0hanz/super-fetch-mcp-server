import type {
  FetchPipelineOptions,
  PipelineResult,
} from '../../config/types.js';

import * as cache from '../../services/cache.js';
import type { FetchOptions } from '../../services/fetcher.js';
import { fetchUrlWithRetry } from '../../services/fetcher.js';
import { logDebug, logWarn } from '../../services/logger.js';

import { validateAndNormalizeUrl } from '../../utils/url-validator.js';

/**
 * Safe JSON parse with error handling for cache deserialization.
 */
function safeJsonParse(cached: string, cacheKey: string): unknown {
  try {
    return JSON.parse(cached);
  } catch {
    logWarn('Cache deserialize failed, treating as miss', {
      key: cacheKey.substring(0, 100),
    });
    return undefined;
  }
}

export async function executeFetchPipeline<T>(
  options: FetchPipelineOptions<T>
): Promise<PipelineResult<T>> {
  const {
    url,
    cacheNamespace,
    customHeaders,
    retries,
    signal,
    timeout,
    transform,
    serialize = JSON.stringify,
    deserialize,
  } = options;

  const normalizedUrl = validateAndNormalizeUrl(url);
  const cacheKey = cache.createCacheKey(cacheNamespace, normalizedUrl);

  // Check cache first
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
      logDebug('Cache hit', { namespace: cacheNamespace, url: normalizedUrl });

      const data = deserialize
        ? deserialize(cached.content)
        : (safeJsonParse(cached.content, cacheKey) as T | undefined);

      if (data !== undefined) {
        return {
          data,
          fromCache: true,
          url: normalizedUrl,
          fetchedAt: cached.fetchedAt,
        };
      }
      logDebug('Cache miss due to deserialize failure', {
        namespace: cacheNamespace,
        url: normalizedUrl,
      });
    }
  }

  // Build fetch options
  const fetchOptions: FetchOptions = {
    customHeaders,
    signal,
    timeout,
  };

  logDebug('Fetching URL', { url: normalizedUrl, retries });
  const html = await fetchUrlWithRetry(normalizedUrl, fetchOptions, retries);
  const data = transform(html, normalizedUrl);

  if (cacheKey) {
    const serialized = serialize(data);
    cache.set(cacheKey, serialized);
  }

  return {
    data,
    fromCache: false,
    url: normalizedUrl,
    fetchedAt: new Date().toISOString(),
  };
}
