import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { Worker } from 'node:worker_threads';

import type { MarkdownTransformResult } from '../config/types/content.js';

import { FetchError } from '../errors/app-error.js';

import { getErrorMessage } from '../utils/error-details.js';

interface WorkerResultMessage {
  type: 'result';
  id: string;
  result: MarkdownTransformResult;
}

interface WorkerErrorMessage {
  type: 'error';
  id: string;
  error: {
    name: string;
    message: string;
    url: string;
    statusCode?: number;
    details?: Record<string, unknown>;
  };
}

type WorkerMessage = WorkerResultMessage | WorkerErrorMessage;

interface PendingTask {
  id: string;
  html: string;
  url: string;
  includeMetadata: boolean;
  signal: AbortSignal | undefined;
  resolve: (result: MarkdownTransformResult) => void;
  reject: (error: unknown) => void;
}

interface InflightTask {
  resolve: PendingTask['resolve'];
  reject: PendingTask['reject'];
  timer: NodeJS.Timeout;
  signal: AbortSignal | undefined;
  abortListener: (() => void) | undefined;
  workerIndex: number;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  currentTaskId: string | null;
}

interface TransformWorkerPool {
  transform(
    html: string,
    url: string,
    options: { includeMetadata: boolean; signal?: AbortSignal }
  ): Promise<MarkdownTransformResult>;
  close(): Promise<void>;
}

let pool: WorkerPool | null = null;

function resolveDefaultWorkerCount(): number {
  const parallelism =
    typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length;

  // Leave 1 core for the event loop; cap to avoid runaway memory.
  return Math.min(16, Math.max(1, parallelism - 1));
}

const DEFAULT_TIMEOUT_MS = 30000;

export function getOrCreateTransformWorkerPool(): TransformWorkerPool {
  pool ??= new WorkerPool(resolveDefaultWorkerCount(), DEFAULT_TIMEOUT_MS);
  return pool;
}

export async function shutdownTransformWorkerPool(): Promise<void> {
  if (!pool) return;
  await pool.close();
  pool = null;
}

class WorkerPool implements TransformWorkerPool {
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: PendingTask[] = [];
  private readonly inflight = new Map<string, InflightTask>();
  private readonly timeoutMs: number;
  private readonly queueMax: number;
  private closed = false;

  constructor(size: number, timeoutMs: number) {
    const safeSize = Math.max(1, size);
    this.timeoutMs = timeoutMs;
    this.queueMax = safeSize * 2;

    for (let index = 0; index < safeSize; index += 1) {
      this.workers.push(this.spawnWorker(index));
    }
  }

  private spawnWorker(workerIndex: number): WorkerSlot {
    const worker = new Worker(
      new URL('../workers/transform-worker.js', import.meta.url)
    );

    // Workers must not keep the process alive by themselves.
    worker.unref();

    const slot: WorkerSlot = {
      worker,
      busy: false,
      currentTaskId: null,
    };

    worker.on('message', (raw: unknown) => {
      this.onWorkerMessage(workerIndex, raw);
    });

    worker.on('error', (error: unknown) => {
      this.onWorkerBroken(
        workerIndex,
        `Transform worker error: ${getErrorMessage(error)}`
      );
    });

    worker.on('exit', (code: number) => {
      this.onWorkerBroken(
        workerIndex,
        `Transform worker exited (code ${code})`
      );
    });

    return slot;
  }

  private onWorkerBroken(workerIndex: number, message: string): void {
    if (this.closed) return;

    const slot = this.workers[workerIndex];
    if (!slot) return;

    if (slot.busy && slot.currentTaskId) {
      this.failTask(slot.currentTaskId, new Error(message));
    }

    void slot.worker.terminate();
    this.workers[workerIndex] = this.spawnWorker(workerIndex);
    this.drainQueue();
  }

  private onWorkerMessage(workerIndex: number, raw: unknown): void {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('type' in raw) ||
      !('id' in raw) ||
      typeof (raw as { id: unknown }).id !== 'string' ||
      typeof (raw as { type: unknown }).type !== 'string'
    ) {
      return;
    }

    const message = raw as WorkerMessage;
    const inflight = this.inflight.get(message.id);
    if (!inflight) return;

    clearTimeout(inflight.timer);
    if (inflight.signal && inflight.abortListener) {
      inflight.signal.removeEventListener('abort', inflight.abortListener);
    }
    this.inflight.delete(message.id);

    const slot = this.workers[workerIndex];
    if (slot) {
      slot.busy = false;
      slot.currentTaskId = null;
    }

    if (message.type === 'result') {
      inflight.resolve(message.result);
    } else {
      const { error } = message;
      if (error.name === 'FetchError') {
        inflight.reject(
          new FetchError(
            error.message,
            error.url,
            error.statusCode,
            error.details ?? {}
          )
        );
      } else {
        inflight.reject(new Error(error.message));
      }
    }

    this.drainQueue();
  }

  private failTask(id: string, error: unknown): void {
    const inflight = this.inflight.get(id);
    if (!inflight) return;

    clearTimeout(inflight.timer);
    if (inflight.signal && inflight.abortListener) {
      inflight.signal.removeEventListener('abort', inflight.abortListener);
    }
    this.inflight.delete(id);
    inflight.reject(error);

    const slot = this.workers[inflight.workerIndex];
    if (slot) {
      slot.busy = false;
      slot.currentTaskId = null;
    }
  }

  async transform(
    html: string,
    url: string,
    options: { includeMetadata: boolean; signal?: AbortSignal }
  ): Promise<MarkdownTransformResult> {
    if (this.closed) {
      throw new Error('Transform worker pool closed');
    }

    if (this.queue.length >= this.queueMax) {
      throw new Error('Transform worker queue is full');
    }

    return new Promise<MarkdownTransformResult>((resolve, reject) => {
      this.queue.push({
        id: randomUUID(),
        html,
        url,
        includeMetadata: options.includeMetadata,
        signal: options.signal,
        resolve,
        reject,
      });

      this.drainQueue();
    });
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;

    for (
      let workerIndex = 0;
      workerIndex < this.workers.length;
      workerIndex += 1
    ) {
      const slot = this.workers[workerIndex];
      if (!slot || slot.busy) continue;

      const task = this.queue.shift();
      if (!task) return;

      this.dispatch(workerIndex, slot, task);

      if (this.queue.length === 0) return;
    }
  }

  private dispatch(
    workerIndex: number,
    slot: WorkerSlot,
    task: PendingTask
  ): void {
    if (task.signal?.aborted) {
      task.reject(
        new FetchError('Request was canceled', task.url, 499, {
          reason: 'aborted',
          stage: 'transform:dispatch',
        })
      );
      return;
    }

    slot.busy = true;
    slot.currentTaskId = task.id;

    const timer = setTimeout(() => {
      try {
        slot.worker.postMessage({ type: 'cancel', id: task.id });
      } catch {
        // ignore
      }

      const inflight = this.inflight.get(task.id);
      if (!inflight) return;

      clearTimeout(inflight.timer);
      if (inflight.signal && inflight.abortListener) {
        inflight.signal.removeEventListener('abort', inflight.abortListener);
      }
      this.inflight.delete(task.id);

      inflight.reject(
        new FetchError('Request timeout', task.url, 504, {
          reason: 'timeout',
          stage: 'transform:worker-timeout',
        })
      );

      if (!this.closed) {
        void slot.worker.terminate();
        this.workers[workerIndex] = this.spawnWorker(workerIndex);
        this.drainQueue();
      }
    }, this.timeoutMs).unref();

    let abortListener: (() => void) | undefined;
    if (task.signal) {
      abortListener = () => {
        try {
          slot.worker.postMessage({ type: 'cancel', id: task.id });
        } catch {
          // ignore
        }
      };
      task.signal.addEventListener('abort', abortListener, { once: true });
    }

    this.inflight.set(task.id, {
      resolve: task.resolve,
      reject: task.reject,
      timer,
      signal: task.signal,
      abortListener,
      workerIndex,
    });

    slot.worker.postMessage({
      type: 'transform',
      id: task.id,
      html: task.html,
      url: task.url,
      includeMetadata: task.includeMetadata,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const terminations = this.workers.map((slot) => slot.worker.terminate());
    this.workers.length = 0;

    for (const [id, inflight] of this.inflight.entries()) {
      clearTimeout(inflight.timer);
      if (inflight.signal && inflight.abortListener) {
        inflight.signal.removeEventListener('abort', inflight.abortListener);
      }
      inflight.reject(new Error('Transform worker pool closed'));
      this.inflight.delete(id);
    }

    for (const task of this.queue) {
      task.reject(new Error('Transform worker pool closed'));
    }
    this.queue.length = 0;

    await Promise.allSettled(terminations);
  }
}
