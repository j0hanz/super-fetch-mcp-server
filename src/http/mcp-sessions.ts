import { randomUUID } from 'node:crypto';
import { setInterval as setIntervalPromise } from 'node:timers/promises';

import type { Request, Response } from 'express';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { config } from '../config/index.js';
import type { SessionEntry } from '../config/types/runtime.js';

import { logError, logInfo, logWarn } from '../services/logger.js';

import { getErrorMessage } from '../utils/error-details.js';

import { createMcpServer } from '../server.js';

export interface SessionStore {
  get: (sessionId: string) => SessionEntry | undefined;
  touch: (sessionId: string) => void;
  set: (sessionId: string, entry: SessionEntry) => void;
  remove: (sessionId: string) => SessionEntry | undefined;
  size: () => number;
  clear: () => SessionEntry[];
  evictExpired: () => SessionEntry[];
  evictOldest: () => SessionEntry | undefined;
}

export interface McpSessionOptions {
  readonly sessionStore: SessionStore;
  readonly maxSessions: number;
}

export function sendJsonRpcError(
  res: Response,
  code: number,
  message: string,
  status = 400
): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id: null,
  });
}

export function getSessionId(req: Request): string | undefined {
  const header = req.headers['mcp-session-id'];
  return Array.isArray(header) ? header[0] : header;
}

export function createSessionStore(sessionTtlMs: number): SessionStore {
  const sessions = new Map<string, SessionEntry>();

  return {
    get: (sessionId) => sessions.get(sessionId),
    touch: (sessionId) => {
      touchSession(sessions, sessionId);
    },
    set: (sessionId, entry) => {
      sessions.set(sessionId, entry);
    },
    remove: (sessionId) => removeSession(sessions, sessionId),
    size: () => sessions.size,
    clear: () => clearSessions(sessions),
    evictExpired: () => evictExpiredSessions(sessions, sessionTtlMs),
    evictOldest: () => evictOldestSession(sessions),
  };
}

function touchSession(
  sessions: Map<string, SessionEntry>,
  sessionId: string
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastSeen = Date.now();
  }
}

function removeSession(
  sessions: Map<string, SessionEntry>,
  sessionId: string
): SessionEntry | undefined {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  return session;
}

function clearSessions(sessions: Map<string, SessionEntry>): SessionEntry[] {
  const entries = Array.from(sessions.values());
  sessions.clear();
  return entries;
}

function evictExpiredSessions(
  sessions: Map<string, SessionEntry>,
  sessionTtlMs: number
): SessionEntry[] {
  const now = Date.now();
  const evicted: SessionEntry[] = [];

  for (const [id, session] of sessions.entries()) {
    if (now - session.lastSeen > sessionTtlMs) {
      sessions.delete(id);
      evicted.push(session);
    }
  }

  return evicted;
}

function evictOldestSession(
  sessions: Map<string, SessionEntry>
): SessionEntry | undefined {
  let oldestId: string | undefined;
  let oldestSeen = Number.POSITIVE_INFINITY;

  for (const [id, session] of sessions.entries()) {
    if (session.lastSeen < oldestSeen) {
      oldestSeen = session.lastSeen;
      oldestId = id;
    }
  }

  if (!oldestId) return undefined;
  const session = sessions.get(oldestId);
  sessions.delete(oldestId);
  return session;
}

let inFlightSessions = 0;

export function reserveSessionSlot(
  store: SessionStore,
  maxSessions: number
): boolean {
  if (store.size() + inFlightSessions >= maxSessions) {
    return false;
  }
  inFlightSessions += 1;
  return true;
}

function releaseSessionSlot(): void {
  if (inFlightSessions > 0) {
    inFlightSessions -= 1;
  }
}

interface SlotTracker {
  readonly releaseSlot: () => void;
  readonly markInitialized: () => void;
  readonly isInitialized: () => boolean;
}

export function createSlotTracker(): SlotTracker {
  let slotReleased = false;
  let initialized = false;
  return {
    releaseSlot: (): void => {
      if (slotReleased) return;
      slotReleased = true;
      releaseSessionSlot();
    },
    markInitialized: (): void => {
      initialized = true;
    },
    isInitialized: (): boolean => initialized,
  };
}

function isServerAtCapacity(store: SessionStore, maxSessions: number): boolean {
  return store.size() + inFlightSessions >= maxSessions;
}

function tryEvictSlot(
  store: SessionStore,
  maxSessions: number,
  evictOldest: (store: SessionStore) => boolean
): boolean {
  const currentSize = store.size();
  const canFreeSlot =
    currentSize >= maxSessions &&
    currentSize - 1 + inFlightSessions < maxSessions;
  return canFreeSlot && evictOldest(store);
}

export function ensureSessionCapacity({
  store,
  maxSessions,
  res,
  evictOldest,
}: {
  store: SessionStore;
  maxSessions: number;
  res: Response;
  evictOldest: (store: SessionStore) => boolean;
}): boolean {
  if (!isServerAtCapacity(store, maxSessions)) {
    return true;
  }

  if (tryEvictSlot(store, maxSessions, evictOldest)) {
    return !isServerAtCapacity(store, maxSessions);
  }

  respondServerBusy(res);
  return false;
}

function respondServerBusy(res: Response): void {
  sendJsonRpcError(res, -32000, 'Server busy: maximum sessions reached', 503);
}

function respondBadRequest(res: Response): void {
  sendJsonRpcError(
    res,
    -32000,
    'Bad Request: Missing session ID or not an initialize request',
    400
  );
}

function createTimeoutController(): {
  clear: () => void;
  set: (timeout: NodeJS.Timeout | null) => void;
} {
  let initTimeout: NodeJS.Timeout | null = null;
  return {
    clear: (): void => {
      if (!initTimeout) return;
      clearTimeout(initTimeout);
      initTimeout = null;
    },
    set: (timeout: NodeJS.Timeout | null): void => {
      initTimeout = timeout;
    },
  };
}

function createTransportAdapter(
  transport: StreamableHTTPServerTransport
): Transport {
  const adapter = buildTransportAdapter(transport);
  attachTransportAccessors(adapter, transport);
  return adapter;
}

function buildTransportAdapter(
  transport: StreamableHTTPServerTransport
): Transport {
  return {
    start: () => transport.start(),
    send: (message, options) => transport.send(message, options),
    close: () => transport.close(),
  };
}

function createAccessorDescriptor<T>(
  getter: () => T,
  setter?: (value: T) => void
): PropertyDescriptor {
  return {
    get: getter,
    ...(setter ? { set: setter } : {}),
    enumerable: true,
    configurable: true,
  };
}

type CloseHandler = (() => void) | undefined;
type ErrorHandler = ((error: Error) => void) | undefined;
type MessageHandler = Transport['onmessage'];

function createOnCloseDescriptor(
  transport: StreamableHTTPServerTransport
): PropertyDescriptor {
  return createAccessorDescriptor(
    () => transport.onclose,
    (handler: CloseHandler) => {
      transport.onclose = handler;
    }
  );
}

function createOnErrorDescriptor(
  transport: StreamableHTTPServerTransport
): PropertyDescriptor {
  return createAccessorDescriptor(
    () => transport.onerror,
    (handler: ErrorHandler) => {
      transport.onerror = handler;
    }
  );
}

function createOnMessageDescriptor(
  transport: StreamableHTTPServerTransport
): PropertyDescriptor {
  return createAccessorDescriptor(
    () => transport.onmessage,
    (handler: MessageHandler) => {
      transport.onmessage = handler;
    }
  );
}

function attachTransportAccessors(
  adapter: Transport,
  transport: StreamableHTTPServerTransport
): void {
  Object.defineProperties(adapter, {
    onclose: createOnCloseDescriptor(transport),
    onerror: createOnErrorDescriptor(transport),
    onmessage: createOnMessageDescriptor(transport),
    sessionId: createAccessorDescriptor(() => transport.sessionId),
  });
}

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

function createSessionTransport({
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

function evictExpiredSessionsWithClose(store: SessionStore): number {
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

function evictOldestSessionWithClose(store: SessionStore): boolean {
  const session = store.evictOldest();
  if (!session) return false;
  void session.transport.close().catch((error: unknown) => {
    logWarn('Failed to close evicted session', {
      error: getErrorMessage(error),
    });
  });
  return true;
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
      evictOldest: evictOldestSessionWithClose,
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

async function createAndConnectTransport({
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

export async function resolveTransportForPost({
  res,
  body,
  sessionId,
  options,
}: {
  res: Response;
  body: { method: string };
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
  evictExpiredSessionsWithClose(options.sessionStore);
  return createAndConnectTransport({ options, res });
}

export function startSessionCleanupLoop(
  store: SessionStore,
  sessionTtlMs: number
): AbortController {
  const controller = new AbortController();
  void runSessionCleanupLoop(store, sessionTtlMs, controller.signal).catch(
    handleSessionCleanupError
  );
  return controller;
}

async function runSessionCleanupLoop(
  store: SessionStore,
  sessionTtlMs: number,
  signal: AbortSignal
): Promise<void> {
  const intervalMs = getCleanupIntervalMs(sessionTtlMs);
  for await (const getNow of setIntervalPromise(intervalMs, Date.now, {
    signal,
    ref: false,
  })) {
    handleSessionEvictions(store, getNow());
  }
}

function getCleanupIntervalMs(sessionTtlMs: number): number {
  return Math.min(Math.max(Math.floor(sessionTtlMs / 2), 10000), 60000);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function handleSessionEvictions(store: SessionStore, now: number): void {
  const evicted = evictExpiredSessionsWithClose(store);
  if (evicted > 0) {
    logInfo('Expired sessions evicted', {
      evicted,
      timestamp: new Date(now).toISOString(),
    });
  }
}

function handleSessionCleanupError(error: unknown): void {
  if (isAbortError(error)) {
    return;
  }
  logWarn('Session cleanup loop failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}
