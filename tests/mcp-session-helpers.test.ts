import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createSlotTracker,
  ensureSessionCapacity,
  reserveSessionSlot,
} from '../dist/http/mcp-session-helpers.js';
import type { SessionStore } from '../dist/http/sessions.js';

function createStore(initialSize: number) {
  let currentSize = initialSize;
  return {
    size: () => currentSize,
    setSize: (size: number) => {
      currentSize = size;
    },
  };
}

function createStatusCapture() {
  let statusCode: number | undefined;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: () => res,
  };

  return { res, getStatusCode: () => statusCode };
}

function testReservesAndReleasesSlots() {
  const store = createStore(0);
  const reserved = reserveSessionSlot(store as SessionStore, 1);
  assert.equal(reserved, true);
  const tracker = createSlotTracker();
  tracker.releaseSlot();
}

function testTracksInitializationState() {
  const tracker = createSlotTracker();
  assert.equal(tracker.isInitialized(), false);
  tracker.markInitialized();
  assert.equal(tracker.isInitialized(), true);
  tracker.releaseSlot();
}

function testRejectsWhenAtCapacityWithoutEviction() {
  const store = createStore(1);
  const { res, getStatusCode } = createStatusCapture();

  const allowed = ensureSessionCapacity(
    store as SessionStore,
    1,
    res as never,
    () => false
  );

  assert.equal(allowed, false);
  assert.equal(getStatusCode(), 503);
}

function testAllowsWhenEvictionFreesCapacity() {
  const store = createStore(1);
  const res = { status: () => res, json: () => res };

  const allowed = ensureSessionCapacity(
    store as SessionStore,
    1,
    res as never,
    () => {
      store.setSize(0);
      return true;
    }
  );

  assert.equal(allowed, true);
}

function registerMcpSessionHelpersTests() {
  describe('mcp-session-helpers', () => {
    it('reserves and releases session slots', () => {
      testReservesAndReleasesSlots();
    });
    it('tracks initialization state', () => {
      testTracksInitializationState();
    });
    it('returns false and responds when at capacity without eviction', () => {
      testRejectsWhenAtCapacityWithoutEviction();
    });
    it('allows when eviction frees capacity', () => {
      testAllowsWhenEvictionFreesCapacity();
    });
  });
}

registerMcpSessionHelpersTests();
