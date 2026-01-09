import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { isRecord } from '../utils/guards.js';

export const CACHE_NAMESPACE = 'markdown';

const HASH_PATTERN = /^[a-f0-9.]+$/i;

export function resolveCacheParams(params: unknown): {
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

function isValidNamespace(namespace: string): boolean {
  return namespace === CACHE_NAMESPACE;
}

function isValidHash(hash: string): boolean {
  return HASH_PATTERN.test(hash) && hash.length >= 8 && hash.length <= 64;
}

function resolveStringParam(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
