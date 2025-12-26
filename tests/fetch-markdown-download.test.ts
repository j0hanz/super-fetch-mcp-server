import { beforeEach, describe, expect, it, vi } from 'vitest';

const performSharedFetch = vi.fn();
const mockCacheGet = vi.fn();

vi.mock('../src/tools/handlers/fetch-single.shared.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/tools/handlers/fetch-single.shared.js')
  >('../src/tools/handlers/fetch-single.shared.js');
  return {
    ...actual,
    performSharedFetch,
  };
});

vi.mock('../src/services/cache.js', () => ({
  parseCacheKey: (key: string) => {
    if (!key) return null;
    const [namespace, hash] = key.split(':');
    return namespace && hash ? { namespace, urlHash: hash } : null;
  },
  toResourceUri: (key: string) => {
    if (!key) return null;
    const [namespace, hash] = key.split(':');
    return namespace && hash ? `superfetch://cache/${namespace}/${hash}` : null;
  },
  get: (key: string) => mockCacheGet(key),
}));

vi.mock('../src/config/index.js', () => ({
  config: {
    cache: { enabled: true, ttl: 3600, maxKeys: 100 },
    constants: { maxInlineContentChars: 10 },
    fetcher: { timeout: 30000 },
    logging: { enabled: true, level: 'info' },
  },
}));

vi.mock('../src/services/logger.js', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

describe('fetch-markdown download info', () => {
  const longContent = `# Title\n\n${'a'.repeat(21000)}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue({
      url: 'https://example.com/article',
      title: 'Test Title',
      content: '',
      fetchedAt: new Date().toISOString(),
      expiresAt: '2025-01-01T01:00:00.000Z',
    });

    performSharedFetch.mockResolvedValue({
      pipeline: {
        data: {
          content: longContent,
          markdown: longContent,
          title: 'Test Title',
          truncated: false,
        },
        fromCache: false,
        url: 'https://example.com/article',
        fetchedAt: new Date().toISOString(),
        cacheKey: 'markdown:abc123def456.7890abcd',
      },
      inlineResult: {
        contentSize: longContent.length,
        resourceUri: 'superfetch://cache/markdown/abc123def456.7890abcd',
        resourceMimeType: 'text/markdown',
      },
    });
  });

  it('includes file download info when content exceeds inline limit', async () => {
    const { fetchMarkdownToolHandler } =
      await import('../src/tools/handlers/fetch-markdown.tool.js');

    const result = await fetchMarkdownToolHandler({
      url: 'https://example.com/article',
    });

    expect(result.structuredContent).toBeDefined();

    const file = result.structuredContent?.file as
      | {
          downloadUrl: string;
          fileName: string;
          expiresAt: string;
        }
      | undefined;

    expect(file).toBeDefined();
    expect(file?.downloadUrl).toMatch(/^\/mcp\/downloads\/markdown\//);
    expect(file?.fileName).toMatch(/\.md$/);
    expect(file?.expiresAt).toBe('2025-01-01T01:00:00.000Z');
  });

  it('omits file info when cache key is null', async () => {
    performSharedFetch.mockResolvedValueOnce({
      pipeline: {
        data: {
          content: '# Title',
          markdown: '# Title',
          title: 'Title',
          truncated: false,
        },
        fromCache: false,
        url: 'https://example.com',
        fetchedAt: new Date().toISOString(),
        cacheKey: null,
      },
      inlineResult: {
        contentSize: longContent.length,
        resourceUri: 'superfetch://cache/markdown/abc123def456.7890abcd',
        resourceMimeType: 'text/markdown',
      },
    });

    const { fetchMarkdownToolHandler } =
      await import('../src/tools/handlers/fetch-markdown.tool.js');

    const result = await fetchMarkdownToolHandler({
      url: 'https://example.com',
    });

    expect(result.structuredContent?.file).toBeUndefined();
  });

  it('omits file info when content is inlined', async () => {
    performSharedFetch.mockResolvedValueOnce({
      pipeline: {
        data: {
          content: 'short',
          markdown: 'short',
          title: 'Short Title',
          truncated: false,
        },
        fromCache: false,
        url: 'https://example.com/short',
        fetchedAt: new Date().toISOString(),
        cacheKey: 'markdown:abc123def456.7890abcd',
      },
      inlineResult: {
        content: 'short',
        contentSize: 5,
      },
    });

    const { fetchMarkdownToolHandler } =
      await import('../src/tools/handlers/fetch-markdown.tool.js');

    const result = await fetchMarkdownToolHandler({
      url: 'https://example.com/short',
    });

    expect(result.structuredContent?.file).toBeUndefined();
  });

  it('generates correct filename from URL path', async () => {
    mockCacheGet.mockReturnValueOnce({
      url: 'https://example.com/blog/my-great-article',
      title: 'Test Title',
      content: '',
      fetchedAt: new Date().toISOString(),
      expiresAt: '2025-01-01T01:00:00.000Z',
    });
    performSharedFetch.mockResolvedValueOnce({
      pipeline: {
        data: {
          content: longContent,
          markdown: longContent,
          title: 'Test Title',
          truncated: false,
        },
        fromCache: false,
        url: 'https://example.com/blog/my-great-article',
        fetchedAt: new Date().toISOString(),
        cacheKey: 'markdown:abc123def456.7890abcd',
      },
      inlineResult: {
        contentSize: longContent.length,
        resourceUri: 'superfetch://cache/markdown/abc123def456.7890abcd',
        resourceMimeType: 'text/markdown',
      },
    });

    const { fetchMarkdownToolHandler } =
      await import('../src/tools/handlers/fetch-markdown.tool.js');

    const result = await fetchMarkdownToolHandler({
      url: 'https://example.com/blog/my-great-article',
    });

    const file = result.structuredContent?.file as
      | {
          fileName: string;
        }
      | undefined;

    // Should extract slug from URL path
    expect(file?.fileName).toMatch(/my-great-article\.md$/);
  });
});
