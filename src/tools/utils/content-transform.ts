import { TRUNCATION_MARKER } from '../../config/formatting.js';
import type {
  JsonlTransformResult,
  MarkdownTransformResult,
} from '../../config/types/content.js';

import { extractContent } from '../../services/extractor.js';
import { parseHtml } from '../../services/parser.js';

import { toJsonl } from '../../transformers/jsonl.transformer.js';
import { htmlToMarkdown } from '../../transformers/markdown.transformer.js';

import {
  createContentMetadataBlock,
  determineContentExtractionSource,
  truncateContent,
} from './common.js';

interface ExtractionOptions {
  readonly extractMainContent: boolean;
  readonly includeMetadata: boolean;
}

interface ContentSource {
  readonly sourceHtml: string;
  readonly title: string | undefined;
  readonly metadata: ReturnType<typeof createContentMetadataBlock>;
}

interface ContentLengthOptions {
  readonly maxContentLength?: number;
}

interface MarkdownOptions extends ExtractionOptions, ContentLengthOptions {}

function resolveContentSource(
  html: string,
  url: string,
  options: ExtractionOptions
): ContentSource {
  const { article, metadata: extractedMeta } = extractContent(html, url, {
    extractArticle: options.extractMainContent,
  });

  const shouldExtractFromArticle = determineContentExtractionSource(
    options.extractMainContent,
    article
  );

  const sourceHtml = shouldExtractFromArticle ? article.content : html;
  const metadata = createContentMetadataBlock(
    url,
    article,
    extractedMeta,
    shouldExtractFromArticle,
    options.includeMetadata
  );
  const title = shouldExtractFromArticle ? article.title : extractedMeta.title;

  return { sourceHtml, title, metadata };
}

function buildJsonlPayload(
  context: ContentSource,
  maxContentLength?: number
): { content: string; contentBlocks: number; truncated: boolean } {
  const contentBlocks = parseHtml(context.sourceHtml);
  const { content, truncated } = truncateContent(
    toJsonl(contentBlocks, context.metadata),
    maxContentLength
  );

  return {
    content,
    contentBlocks: contentBlocks.length,
    truncated,
  };
}

function buildMarkdownPayload(
  context: ContentSource,
  maxContentLength?: number
): { content: string; truncated: boolean } {
  const markdown = htmlToMarkdown(context.sourceHtml, context.metadata);
  const { content, truncated } = truncateContent(
    markdown,
    maxContentLength,
    TRUNCATION_MARKER
  );

  return { content, truncated };
}

export function transformHtmlToJsonl(
  html: string,
  url: string,
  options: ExtractionOptions & ContentLengthOptions
): JsonlTransformResult {
  const context = resolveContentSource(html, url, options);
  const { content, contentBlocks, truncated } = buildJsonlPayload(
    context,
    options.maxContentLength
  );

  return {
    content,
    contentBlocks,
    title: context.title,
    ...(truncated && { truncated }),
  };
}

export function transformHtmlToMarkdown(
  html: string,
  url: string,
  options: MarkdownOptions
): MarkdownTransformResult {
  const context = resolveContentSource(html, url, options);
  const { content, truncated } = buildMarkdownPayload(
    context,
    options.maxContentLength
  );

  return {
    markdown: content,
    title: context.title,
    truncated,
  };
}

export function transformHtmlToMarkdownWithBlocks(
  html: string,
  url: string,
  options: ExtractionOptions & ContentLengthOptions
): JsonlTransformResult {
  const context = resolveContentSource(html, url, options);
  const contentBlocks = parseHtml(context.sourceHtml);
  const { content, truncated } = buildMarkdownPayload(
    context,
    options.maxContentLength
  );

  return {
    content,
    contentBlocks: contentBlocks.length,
    title: context.title,
    ...(truncated && { truncated }),
  };
}
