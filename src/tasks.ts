import { randomUUID } from 'node:crypto';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

export type TaskStatus =
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number; // in ms
  pollInterval: number; // in ms
  result?: unknown;
  error?: unknown;
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

export class TaskManager {
  private tasks = new Map<string, TaskState>();

  createTask(
    options?: CreateTaskOptions,
    statusMessage = 'Task started'
  ): TaskState {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const task: TaskState = {
      taskId,
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

  getTask(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  updateTask(
    taskId: string,
    updates: Partial<Omit<TaskState, 'taskId' | 'createdAt'>>
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, {
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    });
  }

  cancelTask(taskId: string): TaskState | undefined {
    const task = this.tasks.get(taskId);
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

  listTasks(): TaskState[] {
    return Array.from(this.tasks.values());
  }

  // Helper to check if task is expired and could be cleaned up
  // In a real implementation, this would be called by a periodic job
  cleanupExpiredTasks(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, task] of this.tasks.entries()) {
      const created = new Date(task.createdAt).getTime();
      if (now - created > task.ttl) {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }
}

export const taskManager = new TaskManager();
