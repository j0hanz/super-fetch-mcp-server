/** Maximum allowed concurrency to prevent resource exhaustion */
const MAX_CONCURRENCY_LIMIT = 10;

/** Minimum concurrency (sequential execution) */
const MIN_CONCURRENCY = 1;

/** Function that executes a task with concurrency control */
type ConcurrencyLimitedExecutor = <T>(task: () => Promise<T>) => Promise<T>;

/** Progress callback for monitoring batch execution */
type ProgressCallback = (completed: number, total: number) => void;

/** Options for concurrent task execution */
interface ConcurrencyExecutionOptions {
  /** Optional callback invoked after each task completion */
  readonly onProgress?: ProgressCallback;
}

/**
 * Creates a concurrency limiter that controls parallel execution.
 * Uses a semaphore pattern to limit concurrent operations.
 */
function createConcurrencyLimiter(limit: number): ConcurrencyLimitedExecutor {
  const maxConcurrency = Math.min(
    Math.max(MIN_CONCURRENCY, limit),
    MAX_CONCURRENCY_LIMIT
  );

  let activeCount = 0;
  const waitingQueue: (() => void)[] = [];

  return async <T>(task: () => Promise<T>): Promise<T> => {
    while (activeCount >= maxConcurrency) {
      await new Promise<void>((resolve) => waitingQueue.push(resolve));
    }

    activeCount++;
    try {
      return await task();
    } finally {
      activeCount--;
      const nextWaiting = waitingQueue.shift();
      if (nextWaiting) nextWaiting();
    }
  };
}

/**
 * Executes an array of async tasks with controlled concurrency.
 * All tasks are executed, with results returned as PromiseSettledResult.
 *
 * @param limit - Maximum concurrent executions (1-10)
 * @param tasks - Array of async task functions
 * @param options - Optional configuration including progress callback
 * @returns Array of settled results for each task
 */
export async function runWithConcurrency<T>(
  limit: number,
  tasks: readonly (() => Promise<T>)[],
  options?: ConcurrencyExecutionOptions
): Promise<PromiseSettledResult<T>[]> {
  const limiter = createConcurrencyLimiter(limit);
  const totalTasks = tasks.length;
  let completedCount = 0;

  const wrappedTasks = tasks.map((task) => async (): Promise<T> => {
    try {
      return await limiter(task);
    } finally {
      completedCount++;
      options?.onProgress?.(completedCount, totalTasks);
    }
  });

  return Promise.allSettled(wrappedTasks.map((task) => task()));
}
