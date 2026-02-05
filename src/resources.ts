import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { config } from './config.js';
import { stableStringify } from './json.js';

/* -------------------------------------------------------------------------------------------------
 * Configuration Resource
 * ------------------------------------------------------------------------------------------------- */

const REDACTED = '<REDACTED>' as const;
const CONFIG_RESOURCE_NAME = 'config' as const;
const CONFIG_RESOURCE_URI = 'internal://config' as const;
const JSON_MIME = 'application/json' as const;

function redactIfPresent(value: string | undefined): string | undefined {
  return value ? REDACTED : undefined;
}

function redactArray(values: readonly string[]): string[] {
  return values.map(() => REDACTED);
}

function scrubAuth(auth: typeof config.auth): typeof config.auth {
  return {
    ...auth,
    clientSecret: redactIfPresent(auth.clientSecret),
    staticTokens: redactArray(auth.staticTokens),
  };
}

function scrubSecurity(
  security: typeof config.security
): typeof config.security {
  return {
    ...security,
    apiKey: redactIfPresent(security.apiKey),
  };
}

function scrubConfig(source: typeof config): typeof config {
  return {
    ...source,
    auth: scrubAuth(source.auth),
    security: scrubSecurity(source.security),
  };
}

export function registerConfigResource(server: McpServer): void {
  server.registerResource(
    CONFIG_RESOURCE_NAME,
    new ResourceTemplate(CONFIG_RESOURCE_URI, { list: undefined }),
    {
      title: 'Server Configuration',
      description: 'Current runtime configuration (secrets redacted)',
      mimeType: JSON_MIME,
    },
    (uri) => {
      const scrubbed = scrubConfig(config);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: JSON_MIME,
            text: stableStringify(scrubbed),
          },
        ],
      };
    }
  );
}
