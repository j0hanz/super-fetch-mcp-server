import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { FetchError } from '../dist/errors.js';
import { fetchWithRedirects } from '../dist/fetch.js';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchWithRedirects', () => {
  it('follows validated redirect targets', async () => {
    let callCount = 0;
    const responses: [Response, Response] = [
      new Response(null, {
        status: 302,
        headers: { location: '/next' },
      }),
      new Response('ok', { status: 200 }),
    ];
    const fetchMock = async () => responses[callCount++];

    globalThis.fetch = fetchMock as typeof fetch;

    const result = await fetchWithRedirects('https://example.com/start', {}, 5);

    assert.equal(result.url, 'https://example.com/next');
    assert.equal(callCount, 2);
  });

  it('fails when a redirect response is missing a Location header', async () => {
    const fetchMock = async () =>
      new Response(null, {
        status: 302,
      });

    globalThis.fetch = fetchMock as typeof fetch;

    await assert.rejects(
      fetchWithRedirects('https://example.com/start', {}, 5),
      (error) => {
        assert.ok(error instanceof FetchError);
        assert.equal(
          error.message,
          'Redirect response missing Location header'
        );
        return true;
      }
    );
  });

  it('fails when too many redirects occur', async () => {
    const fetchMock = async () =>
      new Response(null, {
        status: 302,
        headers: { location: '/next' },
      });

    globalThis.fetch = fetchMock as typeof fetch;

    await assert.rejects(
      fetchWithRedirects('https://example.com/start', {}, 1),
      (error) => {
        assert.ok(error instanceof FetchError);
        assert.equal(error.message, 'Too many redirects');
        return true;
      }
    );
  });

  it('fails when redirect target validation rejects', async () => {
    const fetchMock = async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://blocked.local' },
      });

    globalThis.fetch = fetchMock as typeof fetch;

    await assert.rejects(
      fetchWithRedirects('https://example.com/start', {}, 5)
    );
  });
});
