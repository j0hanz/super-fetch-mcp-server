import type { MarkdownTransformResult } from '../../config/types/content.js';

import { isRecord } from '../../utils/guards.js';

export type CachedMarkdownResult = MarkdownTransformResult & {
  readonly content: string;
};

function parseJsonRecord(input: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(input);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resolveMarkdownContent(
  parsed: Record<string, unknown>
): string | undefined {
  const { markdown } = parsed;
  if (typeof markdown === 'string') return markdown;

  const { content } = parsed;
  if (typeof content === 'string') return content;

  return undefined;
}

function resolveOptionalTitle(
  parsed: Record<string, unknown>
): string | undefined {
  const { title } = parsed;
  if (title === undefined) return undefined;
  return typeof title === 'string' ? title : undefined;
}

function resolveTruncatedFlag(parsed: Record<string, unknown>): boolean {
  const { truncated } = parsed;
  return typeof truncated === 'boolean' ? truncated : false;
}

export function parseCachedMarkdownResult(
  cached: string
): CachedMarkdownResult | undefined {
  const parsed = parseJsonRecord(cached);
  if (!parsed) return undefined;

  const resolvedContent = resolveMarkdownContent(parsed);
  if (resolvedContent === undefined) return undefined;

  const title = resolveOptionalTitle(parsed);
  if (parsed.title !== undefined && title === undefined) return undefined;

  return {
    content: resolvedContent,
    markdown: resolvedContent,
    title,
    truncated: resolveTruncatedFlag(parsed),
  };
}
