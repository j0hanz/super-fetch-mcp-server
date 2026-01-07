import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { config } from '../config/index.js';
import type { McpRequestBody } from '../config/types/runtime.js';

import { logError, logInfo, logWarn } from '../services/logger.js';

import { getErrorMessage } from '../utils/error-utils.js';

import { createMcpServer } from '../server.js';
import { sendJsonRpcError } from './jsonrpc-http.js';
import {
  createSlotTracker,
  ensureSessionCapacity,
  reserveSessionSlot,
  respondBadRequest,
  respondServerBusy,
  type SlotTracker,
} from './mcp-session-helpers.js';
import {
  createTimeoutController,
  createTransportAdapter,
} from './mcp-session-transport.js';
import { type SessionStore } from './sessions.js';

export interface McpSessionOptions {
  readonly sessionStore: SessionStore;
  readonly maxSessions: number;
}

function startSessionInitTimeout(
  transport: StreamableHTTPServerTransport,
  tracker: SlotTracker,
  clearInitTimeout: () => void,
  timeoutMs: number
): NodeJS.Timeout | null {
  if (timeoutMs <= 0) return null;

  const timeout = setTimeout(() => {
    clearInitTimeout();
    if (tracker.isInitialized()) return;

    tracker.releaseSlot();
    void transport.close().catch((error: unknown) => {
      logWarn('Failed to close stalled session', {
        error: getErrorMessage(error),
      });
    });
    logWarn('Session initialization timed out', { timeoutMs });
  }, timeoutMs);

  timeout.unref();
  return timeout;
}

function registerPreInitCloseHandler(
  transport: StreamableHTTPServerTransport,
  tracker: SlotTracker,
  clearInitTimeout: () => void
): void {
  transport.onclose = () => {
    clearInitTimeout();
    if (!tracker.isInitialized()) {
      tracker.releaseSlot();
    }
  };
}

function createStreamableTransport(
  tracker: SlotTracker,
  clearInitTimeout: () => void
): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  registerPreInitCloseHandler(transport, tracker, clearInitTimeout);

  return transport;
}

function createTransportForNewSession(): {
  transport: StreamableHTTPServerTransport;
  tracker: SlotTracker;
  releaseSlot: () => void;
  clearInitTimeout: () => void;
} {
  const tracker = createSlotTracker();
  const timeoutController = createTimeoutController();
  const { clear: clearInitTimeout } = timeoutController;
  const transport = createStreamableTransport(tracker, clearInitTimeout);

  timeoutController.set(
    startSessionInitTimeout(
      transport,
      tracker,
      clearInitTimeout,
      config.server.sessionInitTimeoutMs
    )
  );

  return {
    transport,
    tracker,
    releaseSlot: tracker.releaseSlot,
    clearInitTimeout,
  };
}

function ensureCapacityOrRespond(
  options: McpSessionOptions,
  res: Response
): boolean {
  return ensureSessionCapacity(
    options.sessionStore,
    options.maxSessions,
    res,
    evictOldestSession
  );
}

function reserveSlotOrRespond(
  options: McpSessionOptions,
  res: Response
): boolean {
  if (reserveSessionSlot(options.sessionStore, options.maxSessions)) {
    return true;
  }
  respondServerBusy(res);
  return false;
}

async function connectTransportOrThrow(
  transport: StreamableHTTPServerTransport,
  clearInitTimeout: () => void,
  releaseSlot: () => void
): Promise<void> {
  const mcpServer = createMcpServer();
  const transportAdapter = createTransportAdapter(transport);

  try {
    await mcpServer.connect(transportAdapter);
  } catch (error) {
    clearInitTimeout();
    releaseSlot();
    void transport.close().catch((closeError: unknown) => {
      logWarn('Failed to close transport after connect error', {
        error: getErrorMessage(closeError),
      });
    });
    logError(
      'Failed to initialize MCP session',
      error instanceof Error ? error : undefined
    );
    throw error;
  }
}

function resolveSessionIdOrRespond(
  transport: StreamableHTTPServerTransport,
  res: Response,
  clearInitTimeout: () => void,
  releaseSlot: () => void
): string | null {
  const { sessionId } = transport;
  if (typeof sessionId === 'string') return sessionId;
  clearInitTimeout();
  releaseSlot();
  respondBadRequest(res);
  return null;
}

function finalizeSessionInitialization(
  sessionId: string,
  transport: StreamableHTTPServerTransport,
  tracker: SlotTracker,
  releaseSlot: () => void,
  clearInitTimeout: () => void,
  store: SessionStore
): void {
  clearInitTimeout();
  tracker.markInitialized();
  releaseSlot();
  const now = Date.now();
  store.set(sessionId, {
    transport,
    createdAt: now,
    lastSeen: now,
  });
  transport.onclose = () => {
    store.remove(sessionId);
    logInfo('Session closed');
  };
  logInfo('Session initialized');
}

async function createAndConnectTransport(
  options: McpSessionOptions,
  res: Response
): Promise<StreamableHTTPServerTransport | null> {
  if (!ensureCapacityOrRespond(options, res)) return null;
  if (!reserveSlotOrRespond(options, res)) return null;

  const { transport, tracker, releaseSlot, clearInitTimeout } =
    createTransportForNewSession();
  await connectTransportOrThrow(transport, clearInitTimeout, releaseSlot);

  const sessionId = resolveSessionIdOrRespond(
    transport,
    res,
    clearInitTimeout,
    releaseSlot
  );
  if (!sessionId) return null;

  finalizeSessionInitialization(
    sessionId,
    transport,
    tracker,
    releaseSlot,
    clearInitTimeout,
    options.sessionStore
  );

  return transport;
}

export async function resolveTransportForPost(
  _req: Request,
  res: Response,
  body: McpRequestBody,
  sessionId: string | undefined,
  options: McpSessionOptions
): Promise<StreamableHTTPServerTransport | null> {
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
  return createAndConnectTransport(options, res);
}

export function evictExpiredSessions(store: SessionStore): number {
  const evicted = store.evictExpired();
  for (const session of evicted) {
    void session.transport.close().catch((error: unknown) => {
      logWarn('Failed to close expired session', {
        error: getErrorMessage(error),
      });
    });
  }
  return evicted.length;
}

function evictOldestSession(store: SessionStore): boolean {
  const session = store.evictOldest();
  if (!session) return false;
  void session.transport.close().catch((error: unknown) => {
    logWarn('Failed to close evicted session', {
      error: getErrorMessage(error),
    });
  });
  return true;
}
