import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCachedContentResource } from './cached-content.js';

export function registerResources(server: McpServer): void {
  registerCachedContentResource(server);
}
