import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMcpServer } from '../dist/server.js';

interface CompletionRequest {
  method: 'completion/complete';
  params: {
    ref: { type: 'ref/prompt'; name: string };
    argument: { name: string; value: string };
  };
}

interface CompletionResponse {
  completion: {
    values: string[];
    total: number;
    hasMore: boolean;
  };
}

type CompletionHandler = (
  request: CompletionRequest,
  extra?: unknown
) => Promise<CompletionResponse>;

function getCompletionHandler(
  server: Awaited<ReturnType<typeof createMcpServer>>
): CompletionHandler {
  const handlers = (
    server.server as unknown as {
      _requestHandlers: Map<string, CompletionHandler>;
    }
  )._requestHandlers;
  const handler = handlers.get('completion/complete');
  assert.ok(handler, 'completion/complete handler should be registered');
  return handler;
}

describe('MCP completion handler', () => {
  it('returns empty completions for get-help prompt', async () => {
    const server = await createMcpServer();
    try {
      const complete = getCompletionHandler(server);
      const response = await complete({
        method: 'completion/complete',
        params: {
          ref: { type: 'ref/prompt', name: 'get-help' },
          argument: { name: 'unused', value: '' },
        },
      });

      assert.equal(Array.isArray(response.completion.values), true);
      assert.equal(response.completion.values.length, 0);
      assert.equal(response.completion.total, 0);
      assert.equal(response.completion.hasMore, false);
    } finally {
      await server.close();
    }
  });
});
