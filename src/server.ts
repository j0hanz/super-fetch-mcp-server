import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { config } from './config/index.js';

import { destroyAgents } from './services/fetcher.js';
import { logError, logInfo } from './services/logger.js';

import { registerTools } from './tools/index.js';

import { registerResources } from './resources/index.js';

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: config.server.name,
      version: config.server.version,
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: true, subscribe: true },
        logging: {},
      },
      instructions: `superFetch MCP server v${config.server.version} - AI-optimized web content fetching with JSONL/Markdown output. Provides tools for fetching, parsing, and transforming web content into structured formats suitable for LLM consumption. Supports resource subscriptions for cache updates.`,
    }
  );

  // Register all features using the modern API
  registerTools(server);
  registerResources(server);

  return server;
}

// Export function to start server with stdio transport
export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  // Error handlers
  server.server.onerror = (error) => {
    logError('[MCP Error]', error instanceof Error ? error : { error });
  };

  process.on('SIGINT', async () => {
    process.stdout.write('\nShutting down superFetch MCP server...\n');
    destroyAgents(); // Clean up HTTP connection pools
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  logInfo('superFetch MCP server running on stdio');
}
