import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeFetchPipeline = vi.fn();

vi.mock('../src/tools/utils/fetch-pipeline.js', () => ({
  executeFetchPipeline,
}));

const { fetchLinksToolHandler } =
  await import('../src/tools/handlers/fetch-links.tool.js');

describe('fetchLinksToolHandler', () => {
  beforeEach(() => {
    executeFetchPipeline.mockReset();
    executeFetchPipeline.mockResolvedValue({
      data: { linkCount: 0, links: [], filtered: 0, truncated: false },
      fromCache: false,
      url: 'https://example.com',
      fetchedAt: new Date().toISOString(),
      cacheKey: 'links:abc',
    });
  });

  it('forwards timeout to executeFetchPipeline', async () => {
    await fetchLinksToolHandler({
      url: 'https://example.com',
      timeout: 1500,
    });

    expect(executeFetchPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 1500 })
    );
  });
});
