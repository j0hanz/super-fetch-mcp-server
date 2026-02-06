import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { setInterval } from 'node:timers';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { type CancellableTimeout, createUnrefTimeout } from './timer-utils.js';

export type TaskStatus =
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskError {
  code: number;
  message: string;
  data?: unknown;
}

export interface TaskState {
  taskId: string;
  ownerKey: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number; // in ms
  pollInterval: number; // in ms
  result?: unknown;
  error?: TaskError;
}

export interface CreateTaskOptions {
  ttl?: number;
}

export interface CreateTaskResult {
  task: {
    taskId: string;
    status: TaskStatus;
    statusMessage?: string;
    createdAt: string;
    lastUpdatedAt: string;
    ttl: number;
    pollInterval: number;
  };
  _meta?: Record<string, unknown>;
}

const DEFAULT_TTL_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_OWNER_KEY = 'default';
const DEFAULT_PAGE_SIZE = 50;

const MAX_CURSOR_LENGTH = 256;

const TERMINAL_STATUSES = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
]);

type RunInContext = ReturnType<typeof AsyncLocalStorage.snapshot>;

function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

class TaskManager {
  private tasks = new Map<string, TaskState>();
  private waiters = new Map<string, Set<(task: TaskState) => void>>();

  constructor() {
    this.startCleanupLoop();
  }

  private startCleanupLoop(): void {
    const interval = setInterval(() => {
      for (const [id, task] of this.tasks) {
        if (this.isExpired(task)) {
          this.tasks.delete(id);
        }
      }
    }, 60000);
    interval.unref();
  }

  createTask(
    options?: CreateTaskOptions,
    statusMessage = 'Task started',
    ownerKey: string = DEFAULT_OWNER_KEY
  ): TaskState {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const task: TaskState = {
      taskId,
      ownerKey,
      status: 'working',
      statusMessage,
      createdAt: now,
      lastUpdatedAt: now,
      ttl: options?.ttl ?? DEFAULT_TTL_MS,
      pollInterval: DEFAULT_POLL_INTERVAL_MS,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  getTask(taskId: string, ownerKey?: string): TaskState | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    if (ownerKey && task.ownerKey !== ownerKey) return undefined;

    if (this.isExpired(task)) {
      this.tasks.delete(taskId);
      return undefined;
    }

    return task;
  }

  updateTask(
    taskId: string,
    updates: Partial<Omit<TaskState, 'taskId' | 'createdAt'>>
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (updates.status && task.status !== updates.status) {
      if (isTerminalStatus(task.status)) return;
    }

    Object.assign(task, {
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    });

    this.notifyWaiters(task);
  }

  cancelTask(taskId: string, ownerKey?: string): TaskState | undefined {
    const task = this.getTask(taskId, ownerKey);
    if (!task) return undefined;

    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Cannot cancel task: already in terminal status '${task.status}'`
      );
    }

    this.updateTask(taskId, {
      status: 'cancelled',
      statusMessage: 'The task was cancelled by request.',
    });

    return this.tasks.get(taskId);
  }

  listTasks(options: { ownerKey: string; cursor?: string; limit?: number }): {
    tasks: TaskState[];
    nextCursor?: string;
  } {
    const { ownerKey, cursor, limit } = options;
    const pageSize = limit && limit > 0 ? limit : DEFAULT_PAGE_SIZE;
    const startIndex = cursor ? this.decodeCursor(cursor) : 0;

    if (startIndex === null) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid cursor');
    }

    const allTasks = Array.from(this.tasks.values()).filter((task) => {
      if (task.ownerKey !== ownerKey) return false;
      if (this.isExpired(task)) {
        this.tasks.delete(task.taskId);
        return false;
      }
      return true;
    });

    const page = allTasks.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + page.length;
    const nextCursor =
      nextIndex < allTasks.length ? this.encodeCursor(nextIndex) : undefined;

    return nextCursor ? { tasks: page, nextCursor } : { tasks: page };
  }

  async waitForTerminalTask(
    taskId: string,
    ownerKey: string,
    signal?: AbortSignal
  ): Promise<TaskState | undefined> {
    const task = this.getTask(taskId, ownerKey);
    if (!task) return undefined;
    if (isTerminalStatus(task.status)) return task;

    const createdAtMs = Date.parse(task.createdAt);
    const deadlineMs = Number.isFinite(createdAtMs)
      ? createdAtMs + task.ttl
      : Number.NaN;

    if (Number.isFinite(deadlineMs) && deadlineMs <= Date.now()) {
      this.tasks.delete(taskId);
      return undefined;
    }

    return new Promise((resolve, reject) => {
      const runInContext: RunInContext = AsyncLocalStorage.snapshot();
      const resolveInContext = (value: TaskState | undefined): void => {
        runInContext(() => {
          resolve(value);
        });
      };
      const rejectInContext = (error: unknown): void => {
        runInContext(() => {
          if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error(String(error)));
          }
        });
      };

      let settled = false;
      let waiter: ((updated: TaskState) => void) | null = null;
      let deadlineTimeout: CancellableTimeout<{ timeout: true }> | undefined;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      const onAbort = (): void => {
        settle(() => {
          cleanup();
          removeWaiter();
          rejectInContext(
            new McpError(ErrorCode.ConnectionClosed, 'Request was cancelled')
          );
        });
      };

      const cleanup = (): void => {
        if (deadlineTimeout) {
          deadlineTimeout.cancel();
          deadlineTimeout = undefined;
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const removeWaiter = (): void => {
        const waiters = this.waiters.get(taskId);
        if (!waiters) return;
        if (waiter) waiters.delete(waiter);
        if (waiters.size === 0) this.waiters.delete(taskId);
      };

      waiter = (updated: TaskState): void => {
        settle(() => {
          cleanup();
          resolveInContext(updated);
        });
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      const waiters = this.waiters.get(taskId) ?? new Set();
      waiters.add(waiter);
      this.waiters.set(taskId, waiters);

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (Number.isFinite(deadlineMs)) {
        const timeoutMs = Math.max(0, deadlineMs - Date.now());
        if (timeoutMs === 0) {
          settle(() => {
            cleanup();
            removeWaiter();
            this.tasks.delete(taskId);
            resolveInContext(undefined);
          });
          return;
        }

        deadlineTimeout = createUnrefTimeout(timeoutMs, { timeout: true });
        void deadlineTimeout.promise
          .then(() => {
            settle(() => {
              cleanup();
              removeWaiter();
              this.tasks.delete(taskId);
              resolveInContext(undefined);
            });
          })
          .catch(rejectInContext);
      }
    });
  }

  private notifyWaiters(task: TaskState): void {
    if (!isTerminalStatus(task.status)) return;
    const waiters = this.waiters.get(task.taskId);
    if (!waiters) return;

    this.waiters.delete(task.taskId);
    for (const waiter of waiters) waiter(task);
  }

  private isExpired(task: TaskState): boolean {
    const createdAt = Date.parse(task.createdAt);
    if (!Number.isFinite(createdAt)) return false;
    return Date.now() - createdAt > task.ttl;
  }

  private encodeCursor(index: number): string {
    // Base64url cursors are an opaque pagination token, NOT encryption.
    const raw = String(index);

    const bytes = new TextEncoder().encode(raw);
    if (hasToBase64Method(bytes)) {
      return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
    }

    return Buffer.from(raw, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): number | null {
    // Base64url cursors are an opaque pagination token, NOT encryption.
    try {
      if (!isValidBase64UrlCursor(cursor)) return null;

      const fromBase64 = getUint8ArrayFromBase64();
      const bytes = fromBase64
        ? fromBase64(cursor, {
            alphabet: 'base64url',
            lastChunkHandling: 'strict',
          })
        : Buffer.from(cursor, 'base64url');

      const decoded = new TextDecoder('utf-8').decode(bytes);
      if (!/^\d+$/u.test(decoded)) return null;

      const value = Number.parseInt(decoded, 10);
      if (!Number.isFinite(value) || value < 0) return null;
      return value;
    } catch {
      return null;
    }
  }
}

interface FromBase64Options {
  alphabet?: 'base64url' | 'base64';
  lastChunkHandling?: 'strict' | 'loose' | 'stop-before-partial';
}

type Uint8ArrayFromBase64 = (
  input: string,
  options?: FromBase64Options
) => Uint8Array;

interface ToBase64Options {
  alphabet?: 'base64url' | 'base64';
  omitPadding?: boolean;
}

type Uint8ArrayWithToBase64 = Uint8Array & {
  toBase64: (options?: ToBase64Options) => string;
};

function getUint8ArrayFromBase64(): Uint8ArrayFromBase64 | undefined {
  const maybe = (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64;
  return typeof maybe === 'function'
    ? (maybe as Uint8ArrayFromBase64)
    : undefined;
}

function hasToBase64Method(bytes: Uint8Array): bytes is Uint8ArrayWithToBase64 {
  return (
    typeof (bytes as unknown as { toBase64?: unknown }).toBase64 === 'function'
  );
}

function isValidBase64UrlCursor(cursor: string): boolean {
  if (!cursor) return false;
  if (cursor.length > MAX_CURSOR_LENGTH) return false;

  // base64url alphabet + optional padding.
  if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(cursor)) return false;

  const firstPaddingIndex = cursor.indexOf('=');
  if (firstPaddingIndex !== -1) {
    for (let i = firstPaddingIndex; i < cursor.length; i += 1) {
      if (cursor[i] !== '=') return false;
    }

    // With padding, base64 strings must have a length divisible by 4.
    return cursor.length % 4 === 0;
  }

  // Without padding, valid lengths are 0,2,3 mod 4 (never 1 mod 4).
  return cursor.length % 4 !== 1;
}

export const taskManager = new TaskManager();
