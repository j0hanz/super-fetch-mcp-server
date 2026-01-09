import type { MarkdownTransformResult } from '../../config/types/content.js';

import { logDebug } from '../../services/logger.js';

import { isRawTextContentUrl } from '../../utils/url-transformer.js';

import { looksLikeMarkdown } from './markdown-signals.js';
import {
  addSourceToMarkdown,
  extractTitleFromRawMarkdown,
  hasFrontmatter,
} from './raw-markdown-frontmatter.js';

const HTML_DOCUMENT_PATTERN = /^(<!doctype|<html)/i;

function looksLikeHtmlDocument(trimmed: string): boolean {
  return HTML_DOCUMENT_PATTERN.test(trimmed);
}

function countCommonHtmlTags(content: string): number {
  const matches =
    content.match(/<(html|head|body|div|span|script|style|meta|link)\b/gi) ??
    [];
  return matches.length;
}

function isRawTextContent(content: string): boolean {
  const trimmed = content.trim();
  const isHtmlDocument = looksLikeHtmlDocument(trimmed);
  const hasMarkdownFrontmatter = hasFrontmatter(trimmed);
  const hasTooManyHtmlTags = countCommonHtmlTags(content) > 2;
  const isMarkdown = looksLikeMarkdown(content);

  return (
    !isHtmlDocument &&
    (hasMarkdownFrontmatter || (!hasTooManyHtmlTags && isMarkdown))
  );
}

function buildRawMarkdownPayload({
  rawContent,
  url,
  includeMetadata,
}: {
  rawContent: string;
  url: string;
  includeMetadata: boolean;
}): { content: string; title: string | undefined } {
  const title = extractTitleFromRawMarkdown(rawContent);
  const content = includeMetadata
    ? addSourceToMarkdown(rawContent, url)
    : rawContent;

  return { content, title };
}

export function tryTransformRawContent({
  html,
  url,
  includeMetadata,
}: {
  html: string;
  url: string;
  includeMetadata: boolean;
}): MarkdownTransformResult | null {
  if (!isRawTextContentUrl(url) && !isRawTextContent(html)) {
    return null;
  }

  logDebug('Preserving raw markdown content', { url: url.substring(0, 80) });
  const { content, title } = buildRawMarkdownPayload({
    rawContent: html,
    url,
    includeMetadata,
  });
  return {
    markdown: content,
    title,
    truncated: false,
  };
}
