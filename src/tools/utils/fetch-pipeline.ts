import type {
  FetchPipelineOptions,
  PipelineResult,
} from '../../config/types/runtime.js';

import * as cache from '../../services/cache.js';
import { createCacheKey } from '../../services/cache-keys.js';
import { fetchNormalizedUrl } from '../../services/fetcher.js';
import { logDebug } from '../../services/logger.js';

import { isRecord } from '../../utils/guards.js';
import { transformToRawUrl } from '../../utils/url-transformer.js';
import { normalizeUrl } from '../../utils/url-validator.js';

function attemptCacheRetrieval<T>({
  cacheKey,
  deserialize,
  cacheNamespace,
  normalizedUrl,
}: {
  cacheKey: string | null;
  deserialize: ((cached: string) => T | undefined) | undefined;
  cacheNamespace: string;
  normalizedUrl: string;
}): PipelineResult<T> | null {
  if (!cacheKey) return null;

  const cached = cache.get(cacheKey);
  if (!cached) return null;

  if (!deserialize) {
    logCacheMiss('missing deserializer', cacheNamespace, normalizedUrl);
    return null;
  }

  const data = deserialize(cached.content);
  if (data === undefined) {
    logCacheMiss('deserialize failure', cacheNamespace, normalizedUrl);
    return null;
  }

  logDebug('Cache hit', { namespace: cacheNamespace, url: normalizedUrl });

  return {
    data,
    fromCache: true,
    url: normalizedUrl,
    fetchedAt: cached.fetchedAt,
    cacheKey,
  };
}

function resolveNormalizedUrl(url: string): {
  normalizedUrl: string;
  originalUrl: string;
  transformed: boolean;
} {
  const { normalizedUrl: validatedUrl } = normalizeUrl(url);
  const { url: normalizedUrl, transformed } = transformToRawUrl(validatedUrl);
  return { normalizedUrl, originalUrl: validatedUrl, transformed };
}

export async function executeFetchPipeline<T>(
  options: FetchPipelineOptions<T>
): Promise<PipelineResult<T>> {
  const resolvedUrl = resolveNormalizedUrl(options.url);
  logRawUrlTransformation(resolvedUrl);

  const cacheKey = createCacheKey(
    options.cacheNamespace,
    resolvedUrl.normalizedUrl,
    options.cacheVary
  );
  const cachedResult = attemptCacheRetrieval({
    cacheKey,
    deserialize: options.deserialize,
    cacheNamespace: options.cacheNamespace,
    normalizedUrl: resolvedUrl.normalizedUrl,
  });
  if (cachedResult) return cachedResult;

  logDebug('Fetching URL', { url: resolvedUrl.normalizedUrl });
  const fetchOptions =
    options.signal === undefined ? {} : { signal: options.signal };
  const html = await fetchNormalizedUrl(
    resolvedUrl.normalizedUrl,
    fetchOptions
  );
  const data = await options.transform(html, resolvedUrl.normalizedUrl);

  if (cache.isEnabled()) {
    persistCache({
      cacheKey,
      data,
      serialize: options.serialize,
      normalizedUrl: resolvedUrl.normalizedUrl,
    });
  }

  return {
    data,
    fromCache: false,
    url: resolvedUrl.normalizedUrl,
    fetchedAt: new Date().toISOString(),
    cacheKey,
  };
}

function persistCache<T>({
  cacheKey,
  data,
  serialize,
  normalizedUrl,
}: {
  cacheKey: string | null;
  data: T;
  serialize: ((result: T) => string) | undefined;
  normalizedUrl: string;
}): void {
  if (!cacheKey) return;
  const serializer = serialize ?? JSON.stringify;
  const title = extractTitle(data);
  const metadata = {
    url: normalizedUrl,
    ...(title === undefined ? {} : { title }),
  };
  cache.set(cacheKey, serializer(data), metadata);
}

function extractTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const { title } = value;
  return typeof title === 'string' ? title : undefined;
}

function logCacheMiss(
  reason: string,
  cacheNamespace: string,
  normalizedUrl: string
): void {
  logDebug(`Cache miss due to ${reason}`, {
    namespace: cacheNamespace,
    url: normalizedUrl,
  });
}

function logRawUrlTransformation(resolvedUrl: {
  originalUrl: string;
  transformed: boolean;
}): void {
  if (!resolvedUrl.transformed) return;

  logDebug('Using transformed raw content URL', {
    original: resolvedUrl.originalUrl,
  });
}
