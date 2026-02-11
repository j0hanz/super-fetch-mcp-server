import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

interface IconInfo {
  src: string;
  mimeType: string;
}

export function registerInstructionResource(
  server: McpServer,
  instructions: string,
  iconInfo?: IconInfo
): void {
  server.registerResource(
    'superfetch-instructions',
    'internal://instructions',
    {
      title: 'Server Instructions',
      description: 'Guidance for using the superFetch MCP server.',
      mimeType: 'text/markdown',
      annotations: {
        audience: ['assistant'],
        priority: 0.9,
      },
      ...(iconInfo
        ? {
            icons: [
              {
                src: iconInfo.src,
                mimeType: iconInfo.mimeType,
              },
            ],
          }
        : {}),
    },
    (uri): ReadResourceResult => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: instructions,
        },
      ],
    })
  );
}
