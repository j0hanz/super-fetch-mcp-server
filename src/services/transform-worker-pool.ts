import { randomUUID } from 'node:crypto';
import diagnosticsChannel from 'node:diagnostics_channel';
import os from 'node:os';
import { Worker } from 'node:worker_threads';

import type { MarkdownTransformResult } from '../config/types/content.js';

import { FetchError } from '../errors/app-error.js';

import { getErrorMessage } from '../utils/error-details.js';

interface WorkerDispatchEvent {
  v: 1;
  type: 'dispatch' | 'result' | 'error';
  task: 'transform';
  workerIndex: number;
  id: string;
  durationMs?: number;
}

const workerChannel = diagnosticsChannel.channel('superfetch.worker');

function publishWorkerEvent(event: WorkerDispatchEvent): void {
  if (!workerChannel.hasSubscribers) return;
  try {
    workerChannel.publish(event);
  } catch {
    // Avoid crashing the publisher if a subscriber throws.
  }
}

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

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  currentTaskId: string | null;
  startTimeMs: number;
}

let pool: TransformWorkerPool | null = null;

function resolveDefaultWorkerCount(): number {
  const parallelism =
    typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length;

  // Leave 1 core for the main thread / event loop; cap to avoid runaway memory.
  return Math.min(16, Math.max(2, parallelism - 1));
}

const DEFAULT_TIMEOUT_MS = 30000;

export function getOrCreateTransformWorkerPool(): TransformWorkerPool {
  pool ??= new TransformWorkerPool({
    size: resolveDefaultWorkerCount(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  return pool;
}

export async function shutdownTransformWorkerPool(): Promise<void> {
  if (!pool) return;
  await pool.close();
  pool = null;
}

export class TransformWorkerPool {
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: PendingTask[] = [];
  private readonly timeoutMs: number;
  private readonly queueMax: number;
  private readonly size: number;

  constructor(options: { size: number; timeoutMs: number; queueMax?: number }) {
    this.size = Math.max(0, options.size);
    this.timeoutMs = options.timeoutMs;
    const defaultQueueMax = this.size > 0 ? this.size * 2 : 0;
    this.queueMax = options.queueMax ?? defaultQueueMax;

    if (this.size <= 0) {
      return;
    }

    for (let index = 0; index < this.size; index += 1) {
      this.workers.push(this.spawnWorker(index));
    }
  }

  private spawnWorker(workerIndex: number): WorkerSlot {
    const worker = new Worker(
      new URL('../workers/transform-worker.js', import.meta.url)
    );

    // Workers should not keep the process alive by themselves.
    worker.unref();

    const slot: WorkerSlot = {
      worker,
      busy: false,
      currentTaskId: null,
      startTimeMs: 0,
    };

    worker.on('message', (raw: unknown) => {
      this.onWorkerMessage(workerIndex, raw as WorkerMessage);
    });

    worker.on('error', (error: unknown) => {
      this.onWorkerFatal(workerIndex, error);
    });

    worker.on('exit', (code: number) => {
      this.onWorkerExit(workerIndex, code);
    });

    return slot;
  }

  private onWorkerFatal(workerIndex: number, error: unknown): void {
    const slot = this.workers[workerIndex];
    if (!slot) return;

    if (slot.busy && slot.currentTaskId) {
      this.failTask(
        slot.currentTaskId,
        new Error(`Transform worker error: ${getErrorMessage(error)}`)
      );
    }

    void slot.worker.terminate();
    this.workers[workerIndex] = this.spawnWorker(workerIndex);
    this.drainQueue();
  }

  private onWorkerExit(workerIndex: number, code: number): void {
    const slot = this.workers[workerIndex];
    if (!slot) return;

    if (slot.busy && slot.currentTaskId) {
      this.failTask(
        slot.currentTaskId,
        new Error(`Transform worker exited (code ${code})`)
      );
    }

    // Respawn to keep pool healthy.
    this.workers[workerIndex] = this.spawnWorker(workerIndex);
    this.drainQueue();
  }

  private readonly inflight = new Map<
    string,
    {
      resolve: PendingTask['resolve'];
      reject: PendingTask['reject'];
      timer: NodeJS.Timeout;
      signal: AbortSignal | undefined;
      abortListener: (() => void) | undefined;
      workerIndex: number;
    }
  >();

  private onWorkerMessage(workerIndex: number, message: WorkerMessage): void {
    const slot = this.workers[workerIndex];
    if (!slot) return;

    const inflight = this.inflight.get(message.id);
    if (!inflight) return;

    clearTimeout(inflight.timer);
    if (inflight.signal && inflight.abortListener) {
      inflight.signal.removeEventListener('abort', inflight.abortListener);
    }

    const durationMs = Date.now() - slot.startTimeMs;

    if (message.type === 'result') {
      publishWorkerEvent({
        v: 1,
        type: 'result',
        task: 'transform',
        workerIndex,
        id: message.id,
        durationMs,
      });
      inflight.resolve(message.result);
    } else {
      publishWorkerEvent({
        v: 1,
        type: 'error',
        task: 'transform',
        workerIndex,
        id: message.id,
        durationMs,
      });

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

    this.inflight.delete(message.id);
    slot.busy = false;
    slot.currentTaskId = null;
    slot.startTimeMs = 0;

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
      slot.startTimeMs = 0;
    }

    this.drainQueue();
  }

  async transform(
    html: string,
    url: string,
    options: { includeMetadata: boolean; signal?: AbortSignal }
  ): Promise<MarkdownTransformResult> {
    if (this.size <= 0) {
      throw new Error('TransformWorkerPool is disabled');
    }

    if (this.queueMax > 0 && this.queue.length >= this.queueMax) {
      throw new Error('Transform worker queue is full');
    }

    return new Promise<MarkdownTransformResult>((resolve, reject) => {
      const task: PendingTask = {
        id: randomUUID(),
        html,
        url,
        includeMetadata: options.includeMetadata,
        signal: options.signal,
        resolve,
        reject,
      };

      this.queue.push(task);
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

      this.dispatchToWorker(workerIndex, slot, task);

      if (this.queue.length === 0) return;
    }
  }

  private dispatchToWorker(
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
    slot.startTimeMs = Date.now();

    publishWorkerEvent({
      v: 1,
      type: 'dispatch',
      task: 'transform',
      workerIndex,
      id: task.id,
    });

    const timer = setTimeout(() => {
      // Don't reuse a possibly-stuck worker: terminate and respawn.
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

      void slot.worker.terminate();
      this.workers[workerIndex] = this.spawnWorker(workerIndex);
      this.drainQueue();
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

    this.queue.length = 0;

    await Promise.allSettled(terminations);
  }
}
