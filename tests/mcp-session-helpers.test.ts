import { describe, expect, it, vi } from 'vitest';

import {
  createSlotTracker,
  ensureSessionCapacity,
  releaseSessionSlot,
  reserveSessionSlot,
} from '../src/http/mcp-session-helpers.js';
import type { SessionStore } from '../src/http/sessions.js';

function createStore(initialSize: number) {
  let currentSize = initialSize;
  return {
    size: () => currentSize,
    setSize: (size: number) => {
      currentSize = size;
    },
  };
}

describe('mcp-session-helpers', () => {
  it('reserves and releases session slots', () => {
    const store = createStore(0);
    const reserved = reserveSessionSlot(store as SessionStore, 1);
    expect(reserved).toBe(true);
    releaseSessionSlot();
  });

  it('tracks initialization state', () => {
    const tracker = createSlotTracker();
    expect(tracker.isInitialized()).toBe(false);
    tracker.markInitialized();
    expect(tracker.isInitialized()).toBe(true);
    tracker.releaseSlot();
  });

  it('returns false and responds when at capacity without eviction', () => {
    const store = createStore(1);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const allowed = ensureSessionCapacity(
      store as SessionStore,
      1,
      res as never,
      () => false
    );

    expect(allowed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('allows when eviction frees capacity', () => {
    const store = createStore(1);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    const allowed = ensureSessionCapacity(
      store as SessionStore,
      1,
      res as never,
      () => {
        store.setSize(0);
        return true;
      }
    );

    expect(allowed).toBe(true);
  });
});
