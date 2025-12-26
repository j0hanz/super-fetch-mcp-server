import { describe, expect, it, vi } from 'vitest';

const processSingleUrl = vi.fn();

vi.mock('../src/tools/handlers/fetch-urls/processor.js', () => ({
  processSingleUrl,
}));

const { fetchUrlsToolHandler } =
  await import('../src/tools/handlers/fetch-urls.tool.js');

describe('fetchUrlsToolHandler', () => {
  it('stops after the first failure when continueOnError is false', async () => {
    processSingleUrl.mockResolvedValueOnce({
      url: 'https://example.com/a',
      success: false,
      cached: false,
      error: 'failed',
      errorCode: 'FETCH_ERROR',
    });

    processSingleUrl.mockResolvedValue({
      url: 'https://example.com/b',
      success: true,
      cached: false,
      content: 'ok',
      contentSize: 2,
    });

    await fetchUrlsToolHandler({
      urls: ['https://example.com/a', 'https://example.com/b'],
      continueOnError: false,
      concurrency: 1,
      format: 'jsonl',
    });

    expect(processSingleUrl).toHaveBeenCalledTimes(1);
  });
});
