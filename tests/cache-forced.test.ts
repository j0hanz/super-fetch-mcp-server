import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import * as cache from '../dist/cache.js';
import { config } from '../dist/config.js';
import { fetchUrlToolHandler } from '../dist/tools.js';
import { shutdownTransformWorkerPool } from '../dist/transform.js';

after(async () => {
  await shutdownTransformWorkerPool();
});

describe('Forced Cache on Truncation', () => {
  it('generates a resource URI when content is truncated even if cache is disabled', async (t) => {
    const originalCacheEnabled = config.cache.enabled;
    const originalInlineLimit = config.constants.maxInlineContentChars;
    config.cache.enabled = false;
    config.constants.maxInlineContentChars = 20000;

    // Create content larger than maxInlineContentChars (20000)
    const largeContent = 'a'.repeat(25000);
    const html = `<html><body><p>${largeContent}</p></body></html>`;

    try {
      t.mock.method(globalThis, 'fetch', async () => {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      });

      const response = await fetchUrlToolHandler({
        url: 'https://example.com/forced-cache',
      });

      // Check if we got a resource link block
      const resourceBlock = response.content.find(
        (b) => b.type === 'resource_link'
      );

      assert.ok(resourceBlock, 'Should include a resource_link block');
      assert.ok(
        resourceBlock.uri.startsWith('superfetch://cache/markdown/'),
        'URI should be a cache URI'
      );

      const uri = resourceBlock.uri;
      const urlHash = uri.split('/').pop();
      const cacheKey = `markdown:${urlHash}`;

      const cachedEntry = cache.get(cacheKey, { force: true });
      assert.ok(
        cachedEntry,
        'Content should be present in cache store when forced'
      );

      const hiddenEntry = cache.get(cacheKey);
      assert.equal(
        hiddenEntry,
        undefined,
        'Content should be hidden from normal access when cache disabled'
      );
      assert.ok(
        cachedEntry.content.includes(largeContent),
        'Cached content should be the full content'
      );
    } finally {
      config.cache.enabled = originalCacheEnabled;
      config.constants.maxInlineContentChars = originalInlineLimit;
    }
  });
});
