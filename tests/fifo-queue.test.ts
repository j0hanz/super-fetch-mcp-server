import assert from 'node:assert/strict';
import test from 'node:test';

import { FifoQueue } from '../dist/services/fifo-queue.js';

test('FifoQueue preserves FIFO order', () => {
  const queue = new FifoQueue<number>();

  queue.push(1);
  queue.push(2);

  assert.equal(queue.length, 2);
  assert.equal(queue.shift(), 1);
  assert.equal(queue.length, 1);
  assert.equal(queue.shift(), 2);
  assert.equal(queue.length, 0);
  assert.equal(queue.shift(), undefined);
});

test('FifoQueue compacts and keeps order', () => {
  const queue = new FifoQueue<number>();

  for (let i = 0; i < 200; i += 1) queue.push(i);
  for (let i = 0; i < 150; i += 1) assert.equal(queue.shift(), i);

  assert.equal(queue.length, 50);
  assert.equal(queue.shift(), 150);
});
