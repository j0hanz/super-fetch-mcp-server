import type {
  FetchOptions,
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

function attemptCacheRetrieval<T>(
  cacheKey: string | null,
  deserialize: ((cached: string) => T | undefined) | undefined,
  cacheNamespace: string,
  normalizedUrl: string
): PipelineResult<T> | null {
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

  return buildCacheHitResult(data, cached.fetchedAt, normalizedUrl, cacheKey);
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
  if (resolvedUrl.transformed) {
    logDebug('Using transformed raw content URL', {
      original: resolvedUrl.originalUrl,
    });
  }

  const cacheKey = resolveCacheKey(options, resolvedUrl.normalizedUrl);
  const cachedResult = attemptCacheRetrieval(
    cacheKey,
    options.deserialize,
    options.cacheNamespace,
    resolvedUrl.normalizedUrl
  );
  if (cachedResult) return cachedResult;

  const data = await fetchAndTransform(options, resolvedUrl.normalizedUrl);
  if (cache.isEnabled()) {
    persistCache(cacheKey, data, options.serialize, resolvedUrl.normalizedUrl);
  }

  return buildPipelineResult(resolvedUrl.normalizedUrl, data, cacheKey);
}

function resolveCacheKey<T>(
  options: FetchPipelineOptions<T>,
  normalizedUrl: string
): string | null {
  return createCacheKey(
    options.cacheNamespace,
    normalizedUrl,
    options.cacheVary
  );
}

async function fetchAndTransform<T>(
  options: FetchPipelineOptions<T>,
  normalizedUrl: string
): Promise<T> {
  const fetchOptions = buildFetchOptions(options);
  logDebug('Fetching URL', { url: normalizedUrl });

  const html = await fetchNormalizedUrl(normalizedUrl, fetchOptions);
  return options.transform(html, normalizedUrl);
}

function buildFetchOptions<T>(options: FetchPipelineOptions<T>): FetchOptions {
  const fetchOptions: FetchOptions = {};

  if (options.signal !== undefined) {
    fetchOptions.signal = options.signal;
  }

  return fetchOptions;
}

function resolveCacheMetadata(
  data: unknown,
  normalizedUrl: string
): { url: string; title?: string } {
  const metadata: { url: string; title?: string } = { url: normalizedUrl };
  const title = extractTitle(data);
  if (title !== undefined) {
    metadata.title = title;
  }
  return metadata;
}

function resolveSerializer<T>(
  serialize: ((result: T) => string) | undefined
): (result: T) => string {
  return serialize ?? JSON.stringify;
}

function persistCache<T>(
  cacheKey: string | null,
  data: T,
  serialize: ((result: T) => string) | undefined,
  normalizedUrl: string
): void {
  if (!cacheKey) return;
  const serializer = resolveSerializer(serialize);
  const metadata = resolveCacheMetadata(data, normalizedUrl);
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

function buildCacheHitResult<T>(
  data: T,
  fetchedAt: string,
  url: string,
  cacheKey: string
): PipelineResult<T> {
  return {
    data,
    fromCache: true,
    url,
    fetchedAt,
    cacheKey,
  };
}

function buildPipelineResult<T>(
  url: string,
  data: T,
  cacheKey: string | null
): PipelineResult<T> {
  return {
    data,
    fromCache: false,
    url,
    fetchedAt: new Date().toISOString(),
    cacheKey,
  };
}
