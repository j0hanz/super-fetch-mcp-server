import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as cache from '../dist/services/cache.js';
import { createCacheKey } from '../dist/services/cache-keys.js';
import { executeFetchPipeline } from '../dist/tools/utils/fetch-pipeline.js';
import { normalizeUrl } from '../dist/utils/url-validator.js';

type CachedPayload = { value: string };

function createCachedPayload(value: string): CachedPayload {
  return { value };
}

function serializePayload(payload: CachedPayload): string {
  return JSON.stringify(payload);
}

function deserializePayload(value: string): CachedPayload | undefined {
  return JSON.parse(value) as CachedPayload;
}

function buildTestUrl(): string {
  return 'https://example.com/pipeline-test';
}

describe('executeFetchPipeline', () => {
  it('returns cached data and cache metadata when a cache hit occurs', async () => {
    const url = buildTestUrl();
    const normalizedUrl = normalizeUrl(url).normalizedUrl;
    const cacheNamespace = 'pipeline-test';
    const cacheVary = { locale: 'en' };
    const cacheKey = createCacheKey(cacheNamespace, normalizedUrl, cacheVary);

    assert.ok(cacheKey);

    const payload = createCachedPayload('cached');
    cache.set(cacheKey, serializePayload(payload), { url: normalizedUrl });
    const cachedEntry = cache.get(cacheKey);

    assert.ok(cachedEntry);

    const result = await executeFetchPipeline<CachedPayload>({
      url,
      cacheNamespace,
      cacheVary,
      deserialize: deserializePayload,
      transform: async () => {
        throw new Error('transform should not run on cache hit');
      },
    });

    assert.equal(result.fromCache, true);
    assert.equal(result.cacheKey, cacheKey);
    assert.equal(result.url, normalizedUrl);
    assert.equal(result.fetchedAt, cachedEntry.fetchedAt);
    assert.deepEqual(result.data, payload);
  });
});
