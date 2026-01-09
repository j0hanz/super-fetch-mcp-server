import type { CacheKeyParts } from './cache-keys.js';
import { parseCacheKey } from './cache-keys.js';

export interface CacheUpdateEvent extends CacheKeyParts {
  cacheKey: string;
}

type CacheUpdateListener = (event: CacheUpdateEvent) => void;

const updateListeners = new Set<CacheUpdateListener>();

export function onCacheUpdate(listener: CacheUpdateListener): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

export function notifyCacheUpdate(cacheKey: string): void {
  if (updateListeners.size === 0) return;
  const parts = parseCacheKey(cacheKey);
  if (!parts) return;
  const event: CacheUpdateEvent = { cacheKey, ...parts };
  for (const listener of updateListeners) {
    listener(event);
  }
}
