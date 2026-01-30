import { setInterval as setIntervalPromise } from 'node:timers/promises';

import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { logInfo, logWarn } from './observability.js';

// --- Types ---

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
  inFlight: () => number;
  incrementInFlight: () => void;
  decrementInFlight: () => void;
  clear: () => SessionEntry[];
  evictExpired: () => SessionEntry[];
  evictOldest: () => SessionEntry | undefined;
}

export interface SlotTracker {
  readonly releaseSlot: () => void;
  readonly markInitialized: () => void;
  readonly isInitialized: () => boolean;
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

/* -------------------------------------------------------------------------------------------------
 * Cleanup loop
 * ------------------------------------------------------------------------------------------------- */

function getCleanupIntervalMs(sessionTtlMs: number): number {
  return Math.min(Math.max(Math.floor(sessionTtlMs / 2), 10_000), 60_000);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function handleSessionCleanupError(error: unknown): void {
  if (isAbortError(error)) return;

  logWarn('Session cleanup loop failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}

function isSessionExpired(
  session: SessionEntry,
  now: number,
  sessionTtlMs: number
): boolean {
  return now - session.lastSeen > sessionTtlMs;
}

class SessionCleanupLoop {
  constructor(
    private readonly store: SessionStore,
    private readonly sessionTtlMs: number
  ) {}

  start(): AbortController {
    const controller = new AbortController();
    void this.run(controller.signal).catch(handleSessionCleanupError);
    return controller;
  }

  private async run(signal: AbortSignal): Promise<void> {
    const intervalMs = getCleanupIntervalMs(this.sessionTtlMs);

    for await (const getNow of setIntervalPromise(intervalMs, Date.now, {
      signal,
      ref: false,
    })) {
      const now = getNow();
      const evicted = this.store.evictExpired();

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
          timestamp: new Date(now).toISOString(),
        });
      }
    }
  }
}

export function startSessionCleanupLoop(
  store: SessionStore,
  sessionTtlMs: number
): AbortController {
  return new SessionCleanupLoop(store, sessionTtlMs).start();
}

/* -------------------------------------------------------------------------------------------------
 * Session store (in-memory, Map order used for LRU)
 * ------------------------------------------------------------------------------------------------- */

function moveSessionToEnd(
  sessions: Map<string, SessionEntry>,
  sessionId: string,
  session: SessionEntry
): void {
  sessions.delete(sessionId);
  sessions.set(sessionId, session);
}

class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();
  private inflight = 0;

  constructor(private readonly sessionTtlMs: number) {}

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastSeen = Date.now();
    moveSessionToEnd(this.sessions, sessionId, session);
  }

  set(sessionId: string, entry: SessionEntry): void {
    this.sessions.set(sessionId, entry);
  }

  remove(sessionId: string): SessionEntry | undefined {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    return session;
  }

  size(): number {
    return this.sessions.size;
  }

  inFlight(): number {
    return this.inflight;
  }

  incrementInFlight(): void {
    this.inflight += 1;
  }

  decrementInFlight(): void {
    if (this.inflight > 0) this.inflight -= 1;
  }

  clear(): SessionEntry[] {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    return entries;
  }

  evictExpired(): SessionEntry[] {
    const now = Date.now();
    const evicted: SessionEntry[] = [];

    for (const [id, session] of this.sessions.entries()) {
      if (isSessionExpired(session, now, this.sessionTtlMs)) {
        this.sessions.delete(id);
        evicted.push(session);
      }
    }

    return evicted;
  }

  evictOldest(): SessionEntry | undefined {
    const oldest = this.sessions.keys().next();
    if (oldest.done) return undefined;

    const oldestId = oldest.value;
    const session = this.sessions.get(oldestId);
    this.sessions.delete(oldestId);
    return session;
  }
}

export function createSessionStore(sessionTtlMs: number): SessionStore {
  return new InMemorySessionStore(sessionTtlMs);
}

/* -------------------------------------------------------------------------------------------------
 * Slot tracker
 * ------------------------------------------------------------------------------------------------- */

class SessionSlotTracker implements SlotTracker {
  private slotReleased = false;
  private initialized = false;

  constructor(private readonly store: SessionStore) {}

  releaseSlot(): void {
    if (this.slotReleased) return;
    this.slotReleased = true;
    this.store.decrementInFlight();
  }

  markInitialized(): void {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export function createSlotTracker(store: SessionStore): SlotTracker {
  return new SessionSlotTracker(store);
}

export function reserveSessionSlot(
  store: SessionStore,
  maxSessions: number
): boolean {
  if (store.size() + store.inFlight() >= maxSessions) {
    return false;
  }
  store.incrementInFlight();
  return true;
}

/* -------------------------------------------------------------------------------------------------
 * Capacity policy
 * ------------------------------------------------------------------------------------------------- */

function isAtCapacity(store: SessionStore, maxSessions: number): boolean {
  return store.size() + store.inFlight() >= maxSessions;
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
  const inflight = store.inFlight();

  if (currentSize + inflight < maxSessions) return true;

  const canFreeSlot =
    currentSize >= maxSessions && currentSize - 1 + inflight < maxSessions;

  if (canFreeSlot && evictOldest(store)) {
    return !isAtCapacity(store, maxSessions);
  }

  return false;
}
