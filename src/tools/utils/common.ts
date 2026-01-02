import { TRUNCATION_MARKER } from '../../config/formatting.js';
import type {
  ExtractedArticle,
  ExtractedMetadata,
  MetadataBlock,
} from '../../config/types/content.js';
import type { TruncationResult } from '../../config/types/runtime.js';

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
  const metadata: MetadataBlock = {
    type: 'metadata',
    url,
    fetchedAt: now,
  };

  if (shouldExtractFromArticle && article) {
    if (article.title !== undefined) metadata.title = article.title;
    if (article.byline !== undefined) metadata.author = article.byline;
    return metadata;
  }

  if (extractedMeta.title !== undefined) metadata.title = extractedMeta.title;
  if (extractedMeta.description !== undefined) {
    metadata.description = extractedMeta.description;
  }
  if (extractedMeta.author !== undefined)
    metadata.author = extractedMeta.author;

  return metadata;
}

export function truncateContent(
  content: string,
  maxLength?: number,
  suffix = TRUNCATION_MARKER
): TruncationResult {
  if (
    maxLength === undefined ||
    maxLength <= 0 ||
    content.length <= maxLength
  ) {
    return { content, truncated: false };
  }

  const safeMax = Math.max(0, maxLength - suffix.length);
  const marker =
    suffix.length > maxLength ? suffix.substring(0, maxLength) : suffix;

  return {
    content: `${content.substring(0, safeMax)}${marker}`,
    truncated: true,
  };
}
