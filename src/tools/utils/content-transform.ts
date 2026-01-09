import type {
  ExtractedArticle,
  ExtractedMetadata,
  MarkdownTransformResult,
  MetadataBlock,
  TransformOptions,
} from '../../config/types/content.js';

import { extractContent } from '../../services/extractor.js';
import { logDebug } from '../../services/logger.js';

import { htmlToMarkdown } from '../../transformers/markdown.js';

import { tryTransformRawContent } from './raw-markdown.js';

const MIN_CONTENT_RATIO = 0.3;
const MIN_HTML_LENGTH_FOR_GATE = 100;

function stripHtmlTags(html: string): string {
  const parts: string[] = [];
  let inTag = false;

  for (const char of html) {
    if (char === '<') {
      inTag = true;
      continue;
    }
    if (char === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) {
      parts.push(char);
    }
  }

  return parts.join('');
}

function estimateTextLength(html: string): number {
  return stripHtmlTags(html).replace(/\s+/g, ' ').trim().length;
}

export function isExtractionSufficient(
  article: ExtractedArticle | null,
  originalHtml: string
): boolean {
  if (!article) return false;

  const articleLength = article.textContent.length;
  const originalLength = estimateTextLength(originalHtml);

  if (originalLength < MIN_HTML_LENGTH_FOR_GATE) return true;

  return articleLength / originalLength >= MIN_CONTENT_RATIO;
}

export function determineContentExtractionSource(
  article: ExtractedArticle | null
): article is ExtractedArticle {
  return !!article;
}

function applyArticleMetadata(
  metadata: MetadataBlock,
  article: ExtractedArticle
): void {
  if (article.title !== undefined) metadata.title = article.title;
  if (article.byline !== undefined) metadata.author = article.byline;
}

function applyExtractedMetadata(
  metadata: MetadataBlock,
  extractedMeta: ExtractedMetadata
): void {
  if (extractedMeta.title !== undefined) metadata.title = extractedMeta.title;
  if (extractedMeta.description !== undefined) {
    metadata.description = extractedMeta.description;
  }
  if (extractedMeta.author !== undefined) {
    metadata.author = extractedMeta.author;
  }
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
    applyArticleMetadata(metadata, article);
    return metadata;
  }

  applyExtractedMetadata(metadata, extractedMeta);

  return metadata;
}

interface ContentSource {
  readonly sourceHtml: string;
  readonly title: string | undefined;
  readonly metadata: ReturnType<typeof createContentMetadataBlock>;
}

function buildArticleContentSource({
  url,
  article,
  extractedMeta,
  includeMetadata,
}: {
  url: string;
  article: ExtractedArticle;
  extractedMeta: ExtractedMetadata;
  includeMetadata: boolean;
}): ContentSource {
  const metadata = createContentMetadataBlock(
    url,
    article,
    extractedMeta,
    true,
    includeMetadata
  );

  return {
    sourceHtml: article.content,
    title: article.title,
    metadata,
  };
}

function buildFullHtmlContentSource({
  html,
  url,
  article,
  extractedMeta,
  includeMetadata,
}: {
  html: string;
  url: string;
  article: ExtractedArticle | null;
  extractedMeta: ExtractedMetadata;
  includeMetadata: boolean;
}): ContentSource {
  const metadata = createContentMetadataBlock(
    url,
    article,
    extractedMeta,
    false,
    includeMetadata
  );

  return {
    sourceHtml: html,
    title: extractedMeta.title,
    metadata,
  };
}

function logQualityGateFallback({
  url,
  articleLength,
}: {
  url: string;
  articleLength: number;
}): void {
  logDebug(
    'Quality gate: Readability extraction below threshold, using full HTML',
    {
      url: url.substring(0, 80),
      articleLength,
    }
  );
}

function tryBuildExtractedArticleContentSource({
  html,
  url,
  article,
  extractedMeta,
  includeMetadata,
}: {
  html: string;
  url: string;
  article: ExtractedArticle | null;
  extractedMeta: ExtractedMetadata;
  includeMetadata: boolean;
}): ContentSource | null {
  if (!article) return null;

  const shouldExtractFromArticle = determineContentExtractionSource(article);
  if (shouldExtractFromArticle && isExtractionSufficient(article, html)) {
    return buildArticleContentSource({
      url,
      article,
      extractedMeta,
      includeMetadata,
    });
  }

  if (shouldExtractFromArticle) {
    logQualityGateFallback({
      url,
      articleLength: article.textContent.length,
    });
  }

  return null;
}

function resolveContentSource({
  html,
  url,
  includeMetadata,
}: {
  html: string;
  url: string;
  includeMetadata: boolean;
}): ContentSource {
  const { article, metadata: extractedMeta } = extractContent(html, url, {
    extractArticle: true,
  });

  const extracted = tryBuildExtractedArticleContentSource({
    html,
    url,
    article,
    extractedMeta,
    includeMetadata,
  });
  if (extracted) return extracted;

  return buildFullHtmlContentSource({
    html,
    url,
    article,
    extractedMeta,
    includeMetadata,
  });
}

export function transformHtmlToMarkdown(
  html: string,
  url: string,
  options: TransformOptions
): MarkdownTransformResult {
  const raw = tryTransformRawContent({
    html,
    url,
    includeMetadata: options.includeMetadata,
  });
  if (raw) return raw;

  const context = resolveContentSource({
    html,
    url,
    includeMetadata: options.includeMetadata,
  });
  const content = htmlToMarkdown(context.sourceHtml, context.metadata);

  return {
    markdown: content,
    title: context.title,
    truncated: false,
  };
}
