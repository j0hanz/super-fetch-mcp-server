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
 * Returns undefined on parse failure, treating it as a cache miss.
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

// Request deduplication store to prevent concurrent identical requests
interface PendingRequest {
  promise: Promise<PipelineResult<unknown>>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const DEDUPLICATION_TIMEOUT = 60000; // 1 minute TTL

// Cleanup stale pending requests every 30 seconds to prevent memory leak
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingRequests.entries()) {
    if (now - value.timestamp > DEDUPLICATION_TIMEOUT) {
      pendingRequests.delete(key);
    }
  }
}, 30000);

// Allow Node.js to exit if this is the only active timer
cleanupInterval.unref();

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

      // Use provided deserializer or safe JSON parse
      const data = deserialize
        ? deserialize(cached.content)
        : (safeJsonParse(cached.content, cacheKey) as T | undefined);

      // If deserialization failed, treat as cache miss
      if (data === undefined) {
        logDebug('Cache miss due to deserialize failure', {
          namespace: cacheNamespace,
          url: normalizedUrl,
        });
      } else {
        return {
          data,
          fromCache: true,
          url: normalizedUrl,
          fetchedAt: cached.fetchedAt,
        };
      }
    }
  }

  // Check for pending request to prevent duplicate fetches
  // Include custom headers hash to ensure requests with different headers aren't deduplicated
  const headersKey = customHeaders ? JSON.stringify(customHeaders) : '';
  const dedupeKey = `${cacheNamespace}:${normalizedUrl}:${headersKey}`;
  const pending = pendingRequests.get(dedupeKey);
  if (pending) {
    logDebug('Request deduplication hit', { url: normalizedUrl });
    return pending.promise as Promise<PipelineResult<T>>;
  }

  // Build fetch options
  const fetchOptions: FetchOptions = {
    customHeaders,
    signal,
    timeout,
  };

  // Create new request
  const request = (async () => {
    try {
      logDebug('Fetching URL', { url: normalizedUrl, retries });
      const fetchResult = await fetchUrlWithRetry(
        normalizedUrl,
        fetchOptions,
        retries
      );
      const { html } = fetchResult;
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
    } finally {
      // Clean up pending request
      pendingRequests.delete(dedupeKey);
    }
  })();

  pendingRequests.set(dedupeKey, {
    promise: request as Promise<PipelineResult<unknown>>,
    timestamp: Date.now(),
  });
  return request;
}
