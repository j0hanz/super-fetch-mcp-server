import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCacheGet = vi.fn();
const mockConfig = {
  cache: { enabled: true, ttl: 3600 },
  runtime: { httpMode: true },
};

vi.mock('../src/config/index.js', () => ({
  config: mockConfig,
}));

vi.mock('../src/services/cache.js', () => ({
  parseCacheKey: (key: string) => {
    const [namespace, hash] = key.split(':');
    return namespace && hash ? { namespace, urlHash: hash } : null;
  },
  get: (key: string) => mockCacheGet(key),
}));

describe('buildFileDownloadInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to defaults
    mockConfig.cache.enabled = true;
    mockConfig.runtime.httpMode = true;
    mockCacheGet.mockReturnValue({
      url: 'https://example.com/article',
      title: 'Test Article',
      content: '',
      fetchedAt: '2025-01-01T00:00:00.000Z',
      expiresAt: '2025-01-01T01:00:00.000Z',
    });
  });

  it('builds download info from cache key', async () => {
    const { buildFileDownloadInfo } =
      await import('../src/utils/download-url.js');

    const result = buildFileDownloadInfo({
      cacheKey: 'markdown:abc123def456',
      url: 'https://example.com/article',
      title: 'Test Article',
    });

    expect(result).not.toBeNull();
    expect(result?.downloadUrl).toBe('/mcp/downloads/markdown/abc123def456');
    expect(result?.fileName).toMatch(/\.md$/);
    expect(result?.expiresAt).toBe('2025-01-01T01:00:00.000Z');
  });

  it('returns null when cache key is null', async () => {
    const { buildFileDownloadInfo } =
      await import('../src/utils/download-url.js');

    const result = buildFileDownloadInfo({
      cacheKey: null,
      url: 'https://example.com',
    });

    expect(result).toBeNull();
  });

  it('uses jsonl extension for url namespace', async () => {
    const { buildFileDownloadInfo } =
      await import('../src/utils/download-url.js');

    const result = buildFileDownloadInfo({
      cacheKey: 'url:abc123def456',
      url: 'https://example.com/article',
    });

    expect(result?.fileName).toMatch(/\.jsonl$/);
  });

  it('returns null when cache entry is missing', async () => {
    mockCacheGet.mockReturnValue(undefined);
    const { buildFileDownloadInfo } =
      await import('../src/utils/download-url.js');

    const result = buildFileDownloadInfo({
      cacheKey: 'markdown:missing',
      url: 'https://example.com',
    });

    expect(result).toBeNull();
  });

  it('returns null when cache is disabled', async () => {
    mockConfig.cache.enabled = false;

    const { buildFileDownloadInfo } =
      await import('../src/utils/download-url.js');

    const result = buildFileDownloadInfo({
      cacheKey: 'markdown:abc123',
      url: 'https://example.com',
    });

    expect(result).toBeNull();
  });

  it('returns null when not in HTTP mode', async () => {
    mockConfig.runtime.httpMode = false;

    const { buildFileDownloadInfo } =
      await import('../src/utils/download-url.js');

    const result = buildFileDownloadInfo({
      cacheKey: 'markdown:abc123def456',
      url: 'https://example.com',
    });

    expect(result).toBeNull();
  });
});
