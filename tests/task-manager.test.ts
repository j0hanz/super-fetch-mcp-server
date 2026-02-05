import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { taskManager } from '../dist/tasks.js';

describe('TaskManager.waitForTerminalTask', () => {
  it('resolves undefined after TTL expiration', { timeout: 2000 }, async () => {
    const task = taskManager.createTask(
      { ttl: 30 },
      'Task started',
      'ttl-test'
    );

    const result = await taskManager.waitForTerminalTask(
      task.taskId,
      'ttl-test'
    );

    assert.equal(result, undefined);
  });
});
