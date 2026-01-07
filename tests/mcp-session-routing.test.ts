import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveTransportForPost } from '../dist/http/mcp-session.js';
import { createSessionStore } from '../dist/http/sessions.js';

describe('mcp-session routing', () => {
  it('returns 404 for POST with unknown mcp-session-id', async () => {
    const sessionStore = createSessionStore(60_000);
    const options = { sessionStore, maxSessions: 10 };

    let statusCode: number | undefined;
    let jsonBody: unknown;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: unknown) => {
        jsonBody = payload;
      },
    };

    const transport = await resolveTransportForPost(
      {} as never,
      res as never,
      { jsonrpc: '2.0', method: 'tools/list', id: 1 } as never,
      'bogus-session-id',
      options as never
    );

    assert.equal(transport, null);
    assert.equal(statusCode, 404);
    assert.equal((jsonBody as { jsonrpc?: string }).jsonrpc, '2.0');
  });
});
