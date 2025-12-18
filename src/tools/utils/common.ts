import type {
  ExtractedArticle,
  ExtractedMetadata,
  MetadataBlock,
} from '../../config/types.js';

/** Shared options for content transformation across all fetch tools */
export interface ContentTransformOptions {
  /** Whether to extract main article content using Readability */
  readonly extractMainContent: boolean;
  /** Whether to include metadata in output */
  readonly includeMetadata: boolean;
}

export function determineContentExtractionSource(
  extractMainContent: boolean,
  article: ExtractedArticle | null
): article is ExtractedArticle {
  return extractMainContent && !!article;
}

export function createContentMetadataBlock(
  url: string,
  article: ExtractedArticle | null,
  extractedMeta: ExtractedMetadata,
  shouldExtractFromArticle: boolean,
  includeMetadata: boolean
): MetadataBlock | undefined {
  if (!includeMetadata) return undefined;
  const now = new Date().toISOString();
  return shouldExtractFromArticle && article
    ? {
        type: 'metadata',
        title: article.title,
        author: article.byline,
        url,
        fetchedAt: now,
      }
    : {
        type: 'metadata',
        title: extractedMeta.title,
        description: extractedMeta.description,
        author: extractedMeta.author,
        url,
        fetchedAt: now,
      };
}

/** Result of content truncation operation */
export interface TruncationResult {
  /** The possibly truncated content */
  readonly content: string;
  /** Whether the content was truncated */
  readonly truncated: boolean;
}

/**
 * Enforces maximum content length by truncating if necessary.
 * Returns original content unchanged if within limits.
 */
export function enforceContentLengthLimit(
  content: string,
  maxLength?: number
): TruncationResult {
  const shouldTruncate =
    maxLength !== undefined && maxLength > 0 && content.length > maxLength;

  if (!shouldTruncate) {
    return { content, truncated: false };
  }

  return {
    content: `${content.substring(0, maxLength)}\n...[truncated]`,
    truncated: true,
  };
}
