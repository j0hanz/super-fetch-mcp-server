import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { config } from '../config/index.js';

import { logWarn } from '../services/logger.js';

import { getErrorMessage } from '../utils/error-details.js';

import type { SlotTracker } from './mcp-session-slots.js';
import type { createTimeoutController } from './mcp-session-transport.js';

function startSessionInitTimeout({
  transport,
  tracker,
  clearInitTimeout,
  timeoutMs,
}: {
  transport: StreamableHTTPServerTransport;
  tracker: SlotTracker;
  clearInitTimeout: () => void;
  timeoutMs: number;
}): NodeJS.Timeout | null {
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

export function createSessionTransport({
  tracker,
  timeoutController,
}: {
  tracker: SlotTracker;
  timeoutController: ReturnType<typeof createTimeoutController>;
}): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onclose = () => {
    timeoutController.clear();
    if (!tracker.isInitialized()) {
      tracker.releaseSlot();
    }
  };
  timeoutController.set(
    startSessionInitTimeout({
      transport,
      tracker,
      clearInitTimeout: timeoutController.clear,
      timeoutMs: config.server.sessionInitTimeoutMs,
    })
  );
  return transport;
}
