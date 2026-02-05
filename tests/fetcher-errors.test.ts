import assert from 'node:assert/strict';
import dns from 'node:dns';
import test from 'node:test';

import { FetchError } from '../dist/errors.js';
import { fetchNormalizedUrl } from '../dist/fetch.js';

function withMockedFetch(
  mock: typeof fetch,
  execute: () => Promise<void>
): Promise<void> {
  const originalFetch: typeof fetch = fetch;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mock;

  return execute().finally(() => {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
      originalFetch;
  });
}

test('fetchNormalizedUrl throws rate limit error on 429', async () => {
  await withMockedFetch(
    async () => {
      return new Response('busy', {
        status: 429,
        headers: { 'retry-after': '30' },
      });
    },
    async () => {
      await assert.rejects(
        () => fetchNormalizedUrl('https://example.com'),
        (error: unknown) => {
          assert.ok(error instanceof FetchError);
          assert.equal(error.statusCode, 429);
          assert.equal(error.details.retryAfter, 30);
          return true;
        }
      );
    }
  );
});

test('fetchNormalizedUrl throws http error on non-OK response', async () => {
  await withMockedFetch(
    async () => {
      return new Response('error', { status: 500, statusText: 'Server Error' });
    },
    async () => {
      await assert.rejects(
        () => fetchNormalizedUrl('https://example.com'),
        (error: unknown) => {
          assert.ok(error instanceof FetchError);
          assert.equal(error.statusCode, 500);
          assert.ok(error.message.includes('HTTP 500: Server Error'));
          return true;
        }
      );
    }
  );
});

test('fetchNormalizedUrl maps network failures to FetchError', async () => {
  await withMockedFetch(
    async () => {
      throw new TypeError('Network down');
    },
    async () => {
      await assert.rejects(
        () => fetchNormalizedUrl('https://example.com'),
        (error: unknown) => {
          assert.ok(error instanceof FetchError);
          assert.equal(error.statusCode, 502);
          assert.ok(error.message.includes('Network error'));
          return true;
        }
      );
    }
  );
});

test('fetchNormalizedUrl aborts during DNS preflight', async () => {
  const controller = new AbortController();
  controller.abort();

  const originalLookup = dns.promises.lookup;
  dns.promises.lookup = async () =>
    await new Promise(() => {
      // Never resolves; abort should win.
    });

  const originalFetch: typeof fetch = fetch;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
    async () => {
      throw new Error('fetch should not be called');
    };

  try {
    await assert.rejects(
      () =>
        fetchNormalizedUrl('https://example.com', {
          signal: controller.signal,
        }),
      (error: unknown) => {
        assert.ok(error instanceof FetchError);
        assert.equal(error.statusCode, 499);
        return true;
      }
    );
  } finally {
    dns.promises.lookup = originalLookup;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
      originalFetch;
  }
});
