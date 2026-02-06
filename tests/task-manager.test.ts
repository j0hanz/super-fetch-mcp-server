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

describe('TaskManager.listTasks cursor', () => {
  it('paginates using nextCursor', () => {
    const ownerKey = `cursor-test-${Date.now()}`;

    taskManager.createTask(undefined, 'Task 1', ownerKey);
    taskManager.createTask(undefined, 'Task 2', ownerKey);
    taskManager.createTask(undefined, 'Task 3', ownerKey);

    const page1 = taskManager.listTasks({ ownerKey, limit: 2 });
    assert.equal(page1.tasks.length, 2);
    assert.equal(typeof page1.nextCursor, 'string');
    assert.ok(page1.nextCursor);

    const page2 = taskManager.listTasks({
      ownerKey,
      limit: 2,
      cursor: page1.nextCursor,
    });
    assert.equal(page2.tasks.length, 1);
    assert.equal(page2.nextCursor, undefined);
  });

  it('rejects invalid cursors', () => {
    const ownerKey = `cursor-invalid-${Date.now()}`;
    taskManager.createTask(undefined, 'Task 1', ownerKey);

    assert.throws(
      () => taskManager.listTasks({ ownerKey, cursor: '!!!!', limit: 1 }),
      (err: unknown) =>
        err instanceof Error && err.message.toLowerCase().includes('cursor')
    );

    assert.throws(
      () =>
        taskManager.listTasks({
          ownerKey,
          cursor: 'abcd=ef',
          limit: 1,
        }),
      (err: unknown) =>
        err instanceof Error && err.message.toLowerCase().includes('cursor')
    );

    const tooLong = 'a'.repeat(300);
    assert.throws(
      () => taskManager.listTasks({ ownerKey, cursor: tooLong, limit: 1 }),
      (err: unknown) =>
        err instanceof Error && err.message.toLowerCase().includes('cursor')
    );
  });
});
