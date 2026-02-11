import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpIcon } from './cache.js';

export const GET_HELP_PROMPT_NAME = 'get-help';

export function registerPrompts(
  server: McpServer,
  instructions: string,
  icons?: McpIcon[]
): void {
  server.registerPrompt(
    GET_HELP_PROMPT_NAME,
    {
      title: 'Get Help',
      description: 'Returns usage guidance for the superFetch MCP server.',
      ...(icons ? { icons } : {}),
    },
    () => ({
      description: 'superFetch MCP usage guidance',
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: instructions,
          },
        },
      ],
    })
  );
}
