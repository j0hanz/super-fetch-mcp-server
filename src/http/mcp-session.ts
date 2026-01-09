import type { Response } from 'express';

import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { McpRequestBody } from '../config/types/runtime.js';

import { sendJsonRpcError } from './jsonrpc-http.js';
import { evictExpiredSessions } from './mcp-session-eviction.js';
import { createAndConnectTransport } from './mcp-session-init.js';
import { respondBadRequest } from './mcp-session-slots.js';
import type { McpSessionOptions } from './mcp-session-types.js';

export async function resolveTransportForPost({
  res,
  body,
  sessionId,
  options,
}: {
  res: Response;
  body: McpRequestBody;
  sessionId: string | undefined;
  options: McpSessionOptions;
}): Promise<StreamableHTTPServerTransport | null> {
  if (sessionId) {
    const existingSession = options.sessionStore.get(sessionId);
    if (existingSession) {
      options.sessionStore.touch(sessionId);
      return existingSession.transport;
    }

    // Client supplied a session id but it doesn't exist; Streamable HTTP: invalid session IDs => 404.
    sendJsonRpcError(res, -32600, 'Session not found', 404);
    return null;
  }
  if (!isInitializeRequest(body)) {
    respondBadRequest(res);
    return null;
  }
  evictExpiredSessions(options.sessionStore);
  return createAndConnectTransport({ options, res });
}
