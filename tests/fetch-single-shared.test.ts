import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeFetchPipeline = vi.fn();

vi.mock('../src/tools/utils/fetch-pipeline.js', () => ({
  executeFetchPipeline,
}));

const { performSharedFetch } =
  await import('../src/tools/handlers/fetch-single.shared.js');

describe('performSharedFetch', () => {
  beforeEach(() => {
    executeFetchPipeline.mockReset();
    executeFetchPipeline.mockResolvedValue({
      data: { content: 'hello' },
      fromCache: false,
      url: 'https://example.com',
      fetchedAt: new Date().toISOString(),
      cacheKey: 'url:abc',
    });
  });

  it('forwards timeout to executeFetchPipeline', async () => {
    await performSharedFetch({
      url: 'https://example.com',
      format: 'markdown',
      extractMainContent: true,
      includeMetadata: true,
      timeout: 1234,
      transform: () => ({ content: 'hello' }),
    });

    expect(executeFetchPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 1234 })
    );
  });
});
