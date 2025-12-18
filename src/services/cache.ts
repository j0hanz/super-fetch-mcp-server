import crypto from 'crypto';
import NodeCache from 'node-cache';

import { config } from '../config/index.js';
import type { CacheEntry } from '../config/types.js';

import { logWarn } from './logger.js';

/** Maximum content size in bytes (5MB) */
const MAX_CONTENT_SIZE_BYTES = 5_242_880;

/** Maximum cache key length before hashing */
const MAX_KEY_LENGTH = 500;

/** Hash algorithm for long URLs */
const HASH_ALGORITHM = 'sha256';

/** Hash output length in hex characters */
const HASH_LENGTH = 64;

const contentCache = new NodeCache({
  stdTTL: config.cache.ttl,
  checkperiod: Math.floor(config.cache.ttl / 10),
  useClones: false,
  maxKeys: config.cache.maxKeys,
});

/**
 * Creates a cache key from namespace and URL.
 * Uses SHA-256 hash for URLs exceeding maximum key length.
 */
export function createCacheKey(namespace: string, url: string): string | null {
  if (!namespace || !url) return null;

  const directKey = `${namespace}:${url}`;
  if (directKey.length <= MAX_KEY_LENGTH) {
    return directKey;
  }

  const urlHash = crypto
    .createHash(HASH_ALGORITHM)
    .update(url)
    .digest('hex')
    .substring(0, HASH_LENGTH);

  return `${namespace}:hash:${urlHash}`;
}

/**
 * Retrieves a cache entry by key.
 * Returns undefined if caching is disabled, key is invalid, or entry not found.
 */
export function get(cacheKey: string | null): CacheEntry | undefined {
  if (!config.cache.enabled || !cacheKey) {
    return undefined;
  }

  try {
    return contentCache.get<CacheEntry>(cacheKey);
  } catch (error) {
    logWarn('Cache get error', {
      key: cacheKey.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return undefined;
  }
}

/**
 * Stores content in cache with automatic TTL.
 * Validates content type and size before caching.
 */
export function set(cacheKey: string | null, content: string): void {
  if (!config.cache.enabled || !cacheKey) {
    return;
  }

  if (!content || typeof content !== 'string') {
    return;
  }

  if (content.length > MAX_CONTENT_SIZE_BYTES) {
    logWarn('Cache set skipped: content too large', {
      key: cacheKey.substring(0, 100),
      size: content.length,
      maxSize: MAX_CONTENT_SIZE_BYTES,
    });
    return;
  }

  try {
    const nowMs = Date.now();
    const entry: CacheEntry = {
      url: cacheKey,
      content,
      fetchedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + config.cache.ttl * 1000).toISOString(),
    };

    contentCache.set(cacheKey, entry);
  } catch (error) {
    logWarn('Cache set error', {
      key: cacheKey.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export function keys(): string[] {
  return contentCache.keys();
}
