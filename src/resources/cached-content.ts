import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import * as cache from '../services/cache.js';
import { parseCacheKey, toResourceUri } from '../services/cache-keys.js';
import { logWarn } from '../services/logger.js';

import {
  parseCachedPayload,
  resolveCachedPayloadContent,
} from '../utils/cached-payload.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { isRecord } from '../utils/guards.js';

const CACHE_NAMESPACE = 'markdown';
const HASH_PATTERN = /^[a-f0-9.]+$/i;

function buildResourceEntry(
  namespace: string,
  urlHash: string
): {
  name: string;
  uri: string;
  description: string;
  mimeType: string;
} {
  return {
    name: `${namespace}:${urlHash}`,
    uri: `superfetch://cache/${namespace}/${urlHash}`,
    description: `Cached content entry for ${namespace}`,
    mimeType: 'text/markdown',
  };
}

function listCachedResources(): {
  resources: ReturnType<typeof buildResourceEntry>[];
} {
  const resources = cache
    .keys()
    .map((key) => {
      const parts = parseCacheKey(key);
      if (parts?.namespace !== CACHE_NAMESPACE) return null;
      return buildResourceEntry(parts.namespace, parts.urlHash);
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return { resources };
}

function notifyResourceUpdate(server: McpServer, uri: string): void {
  if (!server.isConnected()) return;
  void server.server.sendResourceUpdated({ uri }).catch((error: unknown) => {
    logWarn('Failed to send resource update notification', {
      uri,
      error: getErrorMessage(error),
    });
  });
}

export function registerCachedContentResource(server: McpServer): void {
  registerCacheContentResource(server);
  registerCacheUpdateSubscription(server);
}

function resolveCacheParams(params: unknown): {
  namespace: string;
  urlHash: string;
} {
  const parsed = requireRecordParams(params);
  const namespace = requireParamString(parsed, 'namespace');
  const urlHash = requireParamString(parsed, 'urlHash');

  if (!isValidNamespace(namespace) || !isValidHash(urlHash)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid cache resource parameters'
    );
  }

  return { namespace, urlHash };
}

function requireRecordParams(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid cache resource parameters'
    );
  }
  return value;
}

function requireParamString(
  params: Record<string, unknown>,
  key: 'namespace' | 'urlHash'
): string {
  const raw = params[key];
  const resolved = resolveStringParam(raw);
  if (!resolved) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Both namespace and urlHash parameters are required'
    );
  }
  return resolved;
}

function buildCachedContentResponse(
  uri: URL,
  cacheKey: string
): { contents: { uri: string; mimeType: string; text: string }[] } {
  const cached = requireCacheEntry(cacheKey);
  return buildMarkdownContentResponse(uri, cached.content);
}

function registerCacheContentResource(server: McpServer): void {
  server.registerResource(
    'cached-content',
    new ResourceTemplate('superfetch://cache/{namespace}/{urlHash}', {
      list: listCachedResources,
    }),
    {
      title: 'Cached Content',
      description:
        'Access previously fetched web content from cache. Namespace: markdown. UrlHash: SHA-256 hash of the URL.',
      mimeType: 'text/plain',
    },
    (uri, params) => {
      const { namespace, urlHash } = resolveCacheParams(params);
      const cacheKey = `${namespace}:${urlHash}`;
      return buildCachedContentResponse(uri, cacheKey);
    }
  );
}

function registerCacheUpdateSubscription(server: McpServer): void {
  const unsubscribe = cache.onCacheUpdate(({ cacheKey }) => {
    const resourceUri = toResourceUri(cacheKey);
    if (!resourceUri) return;

    notifyResourceUpdate(server, resourceUri);
    if (server.isConnected()) {
      server.sendResourceListChanged();
    }
  });

  const previousOnClose = server.server.onclose;
  server.server.onclose = () => {
    previousOnClose?.();
    unsubscribe();
  };
}

function isValidNamespace(namespace: string): boolean {
  return namespace === CACHE_NAMESPACE;
}

function isValidHash(hash: string): boolean {
  return HASH_PATTERN.test(hash) && hash.length >= 8 && hash.length <= 64;
}

function resolveStringParam(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requireCacheEntry(cacheKey: string): { content: string } {
  const cached = cache.get(cacheKey);
  if (!cached) {
    throw new McpError(
      -32002,
      `Content not found in cache for key: ${cacheKey}`
    );
  }
  return cached;
}

function buildMarkdownContentResponse(
  uri: URL,
  content: string
): { contents: { uri: string; mimeType: string; text: string }[] } {
  const payload = parseCachedPayload(content);
  const resolvedContent = payload ? resolveCachedPayloadContent(payload) : null;

  if (!resolvedContent) {
    throw new McpError(
      ErrorCode.InternalError,
      'Cached markdown content is missing'
    );
  }

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'text/markdown',
        text: resolvedContent,
      },
    ],
  };
}
