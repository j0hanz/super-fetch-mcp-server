import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getRequestId, runWithRequestContext } from '../dist/observability.js';
import { withRequestContextIfMissing } from '../dist/tools.js';

describe('withRequestContextIfMissing', () => {
  it('establishes a request context when none exists', async () => {
    const wrapped = withRequestContextIfMissing(async (_params: unknown) => {
      return getRequestId();
    });

    assert.equal(getRequestId(), undefined);
    const requestId = await wrapped({});
    assert.ok(requestId);
    assert.equal(getRequestId(), undefined);
  });

  it('uses the MCP requestId when provided via handler extra', async () => {
    const wrapped = withRequestContextIfMissing(async (_params: unknown) => {
      return getRequestId();
    });

    assert.equal(getRequestId(), undefined);
    const requestId = await wrapped({}, { requestId: 'mcp-request-123' });
    assert.equal(requestId, 'mcp-request-123');
    assert.equal(getRequestId(), undefined);
  });

  it('preserves an existing request context', async () => {
    const wrapped = withRequestContextIfMissing(async (_params: unknown) => {
      return getRequestId();
    });

    const requestId = await runWithRequestContext(
      { requestId: 'existing-request', operationId: 'existing-op' },
      async () => wrapped({})
    );

    assert.equal(requestId, 'existing-request');
  });
});
