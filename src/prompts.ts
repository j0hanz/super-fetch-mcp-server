import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

import type { McpIcon } from './cache.js';

export const GET_HELP_PROMPT_NAME = 'get-help';

const PROMPT_DESCRIPTION =
  'Returns usage guidance for the superFetch MCP server.';

export function registerPrompts(
  server: McpServer,
  instructions: string,
  icons?: McpIcon[]
): void {
  server.registerPrompt(
    GET_HELP_PROMPT_NAME,
    {
      title: 'Get Help',
      description: PROMPT_DESCRIPTION,
      ...(icons ? { icons } : {}),
    },
    (): GetPromptResult => ({
      description: PROMPT_DESCRIPTION,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: instructions,
          },
        },
      ],
    })
  );
}
