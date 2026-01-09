import type {
  ExtractedArticle,
  ExtractedMetadata,
  MarkdownTransformResult,
  TransformOptions,
} from '../../config/types/content.js';

import { extractContent } from '../../services/extractor.js';
import { logDebug } from '../../services/logger.js';

import { htmlToMarkdown } from '../../transformers/markdown.transformer.js';

import {
  createContentMetadataBlock,
  determineContentExtractionSource,
  isExtractionSufficient,
} from './content-shaping.js';
import { tryTransformRawContent } from './raw-markdown.js';

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
