import { JSDOM, VirtualConsole } from 'jsdom';

import { Readability } from '@mozilla/readability';

import type {
  ExtractedArticle,
  ExtractedMetadata,
  ExtractionResult,
} from '../config/types.js';

import { truncateHtml } from '../utils/html-truncator.js';

import { logError, logWarn } from './logger.js';

const sharedVirtualConsole = new VirtualConsole();
sharedVirtualConsole.on('error', () => {});
sharedVirtualConsole.on('warn', () => {});

function extractOpenGraph(document: Document): {
  title?: string;
  description?: string;
  author?: string;
} {
  const data: { title?: string; description?: string } = {};
  const ogTags = document.querySelectorAll('meta[property^="og:"]');

  for (const tag of ogTags) {
    const property = tag.getAttribute('property');
    const content = tag.getAttribute('content')?.trim();
    if (!property || !content) continue;

    const key = property.replace('og:', '');
    if (key === 'title') data.title = content;
    else if (key === 'description') data.description = content;
  }

  return data;
}

function extractTwitterCard(document: Document): {
  title?: string;
  description?: string;
} {
  const data: { title?: string; description?: string } = {};
  const twitterTags = document.querySelectorAll('meta[name^="twitter:"]');

  for (const tag of twitterTags) {
    const name = tag.getAttribute('name');
    const content = tag.getAttribute('content')?.trim();
    if (!name || !content) continue;

    const key = name.replace('twitter:', '');
    if (key === 'title') data.title = content;
    else if (key === 'description') data.description = content;
  }

  return data;
}

function extractStandardMeta(document: Document): {
  title?: string;
  description?: string;
  author?: string;
} {
  const data: { title?: string; description?: string; author?: string } = {};

  const metaTags = document.querySelectorAll('meta[name][content]');
  for (const tag of metaTags) {
    const name = tag.getAttribute('name');
    const content = tag.getAttribute('content')?.trim();
    if (!name || !content) continue;

    if (name === 'description') data.description = content;
    else if (name === 'author') data.author = content;
  }

  if (!data.title) {
    const titleEl = document.querySelector('title');
    if (titleEl?.textContent) data.title = titleEl.textContent.trim();
  }

  return data;
}

export function extractMetadata(html: string): ExtractedMetadata {
  try {
    const dom = new JSDOM(html);
    const { document } = dom.window;

    const ogData = extractOpenGraph(document);
    const twitterData = extractTwitterCard(document);
    const standardData = extractStandardMeta(document);

    return {
      title: ogData.title ?? twitterData.title ?? standardData.title,
      description:
        ogData.description ??
        twitterData.description ??
        standardData.description,
      author: standardData.author,
    };
  } catch (error) {
    logWarn('Failed to extract metadata', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return {};
  }
}

function extractArticleWithJsdom(
  html: string,
  url: string
): ExtractedArticle | null {
  try {
    const dom = new JSDOM(html, { url, virtualConsole: sharedVirtualConsole });
    const { document } = dom.window;

    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) return null;

    return {
      title: article.title ?? undefined,
      byline: article.byline ?? undefined,
      content: article.content ?? '',
      textContent: article.textContent ?? '',
      excerpt: article.excerpt ?? undefined,
      siteName: article.siteName ?? undefined,
    };
  } catch (error) {
    logError(
      'Failed to extract article with JSDOM',
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

export function extractContent(
  html: string,
  url: string,
  options: { extractArticle?: boolean } = { extractArticle: true }
): ExtractionResult {
  if (!html || typeof html !== 'string') {
    logWarn('extractContent called with invalid HTML input');
    return { article: null, metadata: {} };
  }

  if (!url || typeof url !== 'string') {
    logWarn('extractContent called with invalid URL');
    return { article: null, metadata: {} };
  }

  try {
    const metadata = extractMetadata(truncateHtml(html));

    const article = options.extractArticle
      ? extractArticleWithJsdom(truncateHtml(html), url)
      : null;

    return { article, metadata };
  } catch (error) {
    logError(
      'Failed to extract content',
      error instanceof Error ? error : undefined
    );
    return { article: null, metadata: {} };
  }
}
