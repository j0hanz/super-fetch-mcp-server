import { TRUNCATION_MARKER } from '../../config/formatting.js';
import { config } from '../../config/index.js';

import { toResourceUri } from '../../services/cache-keys.js';

interface InlineContentResult {
  content?: string;
  contentSize: number;
  resourceUri?: string;
  resourceMimeType?: string;
  error?: string;
  truncated?: boolean;
}

export function applyInlineContentLimit(
  content: string,
  cacheKey: string | null
): InlineContentResult {
  const contentSize = content.length;
  const inlineLimit = config.constants.maxInlineContentChars;

  if (contentSize <= inlineLimit) {
    return { content, contentSize };
  }

  const resourceUri = resolveResourceUri(cacheKey);
  if (!resourceUri) {
    return buildTruncatedFallback(content, contentSize, inlineLimit);
  }

  return {
    contentSize,
    resourceUri,
    resourceMimeType: 'text/markdown',
  };
}

function resolveResourceUri(cacheKey: string | null): string | null {
  if (!config.cache.enabled || !cacheKey) return null;
  return toResourceUri(cacheKey);
}

function buildTruncatedFallback(
  content: string,
  contentSize: number,
  inlineLimit: number
): InlineContentResult {
  const maxContentLength = Math.max(0, inlineLimit - TRUNCATION_MARKER.length);
  const truncatedContent =
    content.length > inlineLimit
      ? `${content.substring(0, maxContentLength)}${TRUNCATION_MARKER}`
      : content;

  return {
    content: truncatedContent,
    contentSize,
    truncated: true,
  };
}
