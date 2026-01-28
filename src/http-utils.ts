import { isIP } from 'node:net';
import { setInterval as setIntervalPromise } from 'node:timers/promises';

import { z } from 'zod';

import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { config } from './config.js';
import { logDebug, logInfo, logWarn } from './observability.js';

// --- Types ---

export type JsonRpcId = string | number | null;

export interface McpRequestParams {
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpRequestBody {
  jsonrpc: '2.0';
  method: string;
  id?: JsonRpcId;
  params?: McpRequestParams;
}

export interface SessionEntry {
  readonly transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastSeen: number;
  protocolInitialized: boolean;
}

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

export interface SlotTracker {
  readonly releaseSlot: () => void;
  readonly markInitialized: () => void;
  readonly isInitialized: () => boolean;
}

// --- Host Normalization ---

export function normalizeHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const first = takeFirstHostValue(trimmed);
  if (!first) return null;

  const ipv6 = stripIpv6Brackets(first);
  if (ipv6) return ipv6;

  if (isIpV6Literal(first)) {
    return first;
  }

  return stripPortIfPresent(first);
}

function takeFirstHostValue(value: string): string | null {
  const first = value.split(',')[0];
  if (!first) return null;
  const trimmed = first.trim();
  return trimmed ? trimmed : null;
}

function stripIpv6Brackets(value: string): string | null {
  if (!value.startsWith('[')) return null;
  const end = value.indexOf(']');
  if (end === -1) return null;
  return value.slice(1, end);
}

function stripPortIfPresent(value: string): string {
  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) return value;
  return value.slice(0, colonIndex);
}

function isIpV6Literal(value: string): boolean {
  return isIP(value) === 6;
}

// --- Close Handlers ---

export type CloseHandler = (() => void) | undefined;

export function composeCloseHandlers(
  first: CloseHandler,
  second: CloseHandler
): CloseHandler {
  if (!first) return second;
  if (!second) return first;
  return () => {
    try {
      first();
    } finally {
      second();
    }
  };
}

// --- Session Store ---

function getCleanupIntervalMs(sessionTtlMs: number): number {
  return Math.min(Math.max(Math.floor(sessionTtlMs / 2), 10000), 60000);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function handleSessionCleanupError(error: unknown): void {
  if (isAbortError(error)) {
    return;
  }
  logWarn('Session cleanup loop failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
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
    const evicted = store.evictExpired();
    for (const session of evicted) {
      void session.transport.close().catch((err: unknown) => {
        logWarn('Failed to close expired session', {
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    }
    if (evicted.length > 0) {
      logInfo('Expired sessions evicted', {
        evicted: evicted.length,
        timestamp: new Date(getNow()).toISOString(),
      });
    }
  }
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

export function createSessionStore(sessionTtlMs: number): SessionStore {
  const sessions = new Map<string, SessionEntry>();

  return {
    get: (sessionId) => sessions.get(sessionId),
    touch: (sessionId) => {
      const session = sessions.get(sessionId);
      if (session) {
        session.lastSeen = Date.now();
        sessions.delete(sessionId); // Move to end (LRU behavior if needed, but Map insertion order)
        sessions.set(sessionId, session);
      }
    },
    set: (sessionId, entry) => {
      sessions.set(sessionId, entry);
    },
    remove: (sessionId) => {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      return session;
    },
    size: () => sessions.size,
    clear: () => {
      const entries = Array.from(sessions.values());
      sessions.clear();
      return entries;
    },
    evictExpired: () => {
      const now = Date.now();
      const evicted: SessionEntry[] = [];
      for (const [id, session] of sessions.entries()) {
        if (now - session.lastSeen > sessionTtlMs) {
          sessions.delete(id);
          evicted.push(session);
        }
      }
      return evicted;
    },
    evictOldest: () => {
      const oldestEntry = sessions.keys().next();
      if (oldestEntry.done) return undefined;
      const oldestId = oldestEntry.value;
      const session = sessions.get(oldestId);
      sessions.delete(oldestId);
      return session;
    },
  };
}

// --- Validation ---

const paramsSchema = z.looseObject({});
const mcpRequestSchema = z.looseObject({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  params: paramsSchema.optional(),
});

export function isJsonRpcBatchRequest(body: unknown): boolean {
  return Array.isArray(body);
}

export function isMcpRequestBody(body: unknown): body is McpRequestBody {
  return mcpRequestSchema.safeParse(body).success;
}

// --- Slot Tracker ---

let inFlightSessions = 0;

export function createSlotTracker(): SlotTracker {
  let slotReleased = false;
  let initialized = false;
  return {
    releaseSlot: (): void => {
      if (slotReleased) return;
      slotReleased = true;
      if (inFlightSessions > 0) inFlightSessions--;
    },
    markInitialized: (): void => {
      initialized = true;
    },
    isInitialized: (): boolean => initialized,
  };
}

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

export function ensureSessionCapacity({
  store,
  maxSessions,
  evictOldest,
}: {
  store: SessionStore;
  maxSessions: number;
  evictOldest: (store: SessionStore) => boolean;
}): boolean {
  const currentSize = store.size();
  const isAtCapacity = currentSize + inFlightSessions >= maxSessions;

  if (!isAtCapacity) return true;

  // Try to free a slot
  const canFreeSlot =
    currentSize >= maxSessions &&
    currentSize - 1 + inFlightSessions < maxSessions;

  if (canFreeSlot && evictOldest(store)) {
    return store.size() + inFlightSessions < maxSessions;
  }

  return false;
}

// --- Server Tuning ---

export interface HttpServerTuningTarget {
  headersTimeout?: number;
  requestTimeout?: number;
  keepAliveTimeout?: number;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export function applyHttpServerTuning(server: HttpServerTuningTarget): void {
  const { headersTimeoutMs, requestTimeoutMs, keepAliveTimeoutMs } =
    config.server.http;

  if (headersTimeoutMs !== undefined) {
    server.headersTimeout = headersTimeoutMs;
  }
  if (requestTimeoutMs !== undefined) {
    server.requestTimeout = requestTimeoutMs;
  }
  if (keepAliveTimeoutMs !== undefined) {
    server.keepAliveTimeout = keepAliveTimeoutMs;
  }
}

export function drainConnectionsOnShutdown(
  server: HttpServerTuningTarget
): void {
  const { shutdownCloseAllConnections, shutdownCloseIdleConnections } =
    config.server.http;

  if (shutdownCloseAllConnections) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
      logDebug('Closed all HTTP connections during shutdown');
    }
    return;
  }

  if (shutdownCloseIdleConnections) {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
      logDebug('Closed idle HTTP connections during shutdown');
    }
  }
}
