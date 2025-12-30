import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithRedirects } from '../src/services/fetcher/redirects.js';

const validateAndNormalizeUrlMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/url-validator.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/utils/url-validator.js')
  >('../src/utils/url-validator.js');

  return {
    ...actual,
    validateAndNormalizeUrl: validateAndNormalizeUrlMock,
  };
});

describe('fetchWithRedirects', () => {
  beforeEach(() => {
    validateAndNormalizeUrlMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates redirect targets before following', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/next' },
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    validateAndNormalizeUrlMock.mockResolvedValue('https://example.com/next');
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWithRedirects('https://example.com/start', {}, 5);

    expect(validateAndNormalizeUrlMock).toHaveBeenCalledWith(
      'https://example.com/next'
    );
    expect(result.url).toBe('https://example.com/next');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails when redirect target validation rejects', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://blocked.local' },
      })
    );

    validateAndNormalizeUrlMock.mockRejectedValue(
      new Error('Blocked host: blocked.local')
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRedirects('https://example.com/start', {}, 5)
    ).rejects.toThrow('Blocked host: blocked.local');
  });
});
