import type { Response } from 'express';

import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { logError, logInfo, logWarn } from '../services/logger.js';

import { getErrorMessage } from '../utils/error-details.js';

import { createMcpServer } from '../server.js';
import { evictOldestSession } from './mcp-session-eviction.js';
import {
  createSlotTracker,
  ensureSessionCapacity,
  reserveSessionSlot,
  respondBadRequest,
  respondServerBusy,
  type SlotTracker,
} from './mcp-session-slots.js';
import { createSessionTransport } from './mcp-session-transport-init.js';
import {
  createTimeoutController,
  createTransportAdapter,
} from './mcp-session-transport.js';
import type { McpSessionOptions } from './mcp-session-types.js';
import type { SessionStore } from './sessions.js';

async function connectTransportOrThrow({
  transport,
  clearInitTimeout,
  releaseSlot,
}: {
  transport: StreamableHTTPServerTransport;
  clearInitTimeout: () => void;
  releaseSlot: () => void;
}): Promise<void> {
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

export async function createAndConnectTransport({
  options,
  res,
}: {
  options: McpSessionOptions;
  res: Response;
}): Promise<StreamableHTTPServerTransport | null> {
  if (!reserveSessionIfPossible({ options, res })) return null;

  const tracker = createSlotTracker();
  const timeoutController = createTimeoutController();
  const transport = createSessionTransport({ tracker, timeoutController });

  await connectTransportOrThrow({
    transport,
    clearInitTimeout: timeoutController.clear,
    releaseSlot: tracker.releaseSlot,
  });

  const sessionId = resolveSessionId({
    transport,
    res,
    tracker,
    clearInitTimeout: timeoutController.clear,
  });
  if (!sessionId) return null;

  finalizeSession({
    store: options.sessionStore,
    transport,
    sessionId,
    tracker,
    clearInitTimeout: timeoutController.clear,
  });
  return transport;
}

function reserveSessionIfPossible({
  options,
  res,
}: {
  options: McpSessionOptions;
  res: Response;
}): boolean {
  if (
    !ensureSessionCapacity({
      store: options.sessionStore,
      maxSessions: options.maxSessions,
      res,
      evictOldest: evictOldestSession,
    })
  ) {
    return false;
  }
  if (!reserveSessionSlot(options.sessionStore, options.maxSessions)) {
    respondServerBusy(res);
    return false;
  }
  return true;
}

function resolveSessionId({
  transport,
  res,
  tracker,
  clearInitTimeout,
}: {
  transport: StreamableHTTPServerTransport;
  res: Response;
  tracker: SlotTracker;
  clearInitTimeout: () => void;
}): string | null {
  const { sessionId } = transport;
  if (typeof sessionId !== 'string') {
    clearInitTimeout();
    tracker.releaseSlot();
    respondBadRequest(res);
    return null;
  }
  return sessionId;
}

function finalizeSession({
  store,
  transport,
  sessionId,
  tracker,
  clearInitTimeout,
}: {
  store: SessionStore;
  transport: StreamableHTTPServerTransport;
  sessionId: string;
  tracker: SlotTracker;
  clearInitTimeout: () => void;
}): void {
  clearInitTimeout();
  tracker.markInitialized();
  tracker.releaseSlot();
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
