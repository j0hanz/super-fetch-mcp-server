import type { SessionStore } from './sessions.js';

export interface McpSessionOptions {
  readonly sessionStore: SessionStore;
  readonly maxSessions: number;
}
