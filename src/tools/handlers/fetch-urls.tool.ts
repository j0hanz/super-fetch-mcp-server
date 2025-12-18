import type {
  BatchUrlResult,
  FetchUrlsInput,
  MetadataBlock,
} from '../../config/types.js';
import type {
  BatchResponseContent,
  BatchSummary,
  ToolResponse,
} from '../../config/types.js';

import * as cache from '../../services/cache.js';
import { extractContent, extractMetadata } from '../../services/extractor.js';
import { fetchUrlWithRetry } from '../../services/fetcher.js';
import { logDebug, logError, logWarn } from '../../services/logger.js';
import { parseHtml } from '../../services/parser.js';

import { runWithConcurrency } from '../../utils/concurrency.js';
import { createToolErrorResponse } from '../../utils/tool-error-handler.js';
import { validateAndNormalizeUrl } from '../../utils/url-validator.js';
import {
  createContentMetadataBlock,
  determineContentExtractionSource,
  enforceContentLengthLimit,
} from '../utils/common.js';

import { toJsonl } from '../../transformers/jsonl.transformer.js';
import { htmlToMarkdown } from '../../transformers/markdown.transformer.js';

/** Maximum URLs allowed per batch request */
const MAX_URLS_PER_BATCH = 10;

/** Default concurrent request limit */
const DEFAULT_CONCURRENCY = 3;

/** Maximum concurrent request limit */
const MAX_CONCURRENCY = 5;

export const FETCH_URLS_TOOL_NAME = 'fetch-urls';
export const FETCH_URLS_TOOL_DESCRIPTION =
  'Fetches multiple URLs in parallel and converts them to AI-readable format (JSONL or Markdown). Supports concurrency control and continues on individual failures.';

/** Response type for fetch URLs tool */
interface FetchUrlsToolResponse {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Creates a standardized batch response with summary statistics.
 */
function createBatchResponse(
  results: BatchUrlResult[]
): ToolResponse<BatchResponseContent> {
  const summary: BatchSummary = {
    total: results.length,
    successful: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    cached: results.filter((result) => result.cached).length,
    totalContentBlocks: results.reduce(
      (sum, result) => sum + (result.contentBlocks ?? 0),
      0
    ),
  };

  const structuredContent: BatchResponseContent = {
    results,
    summary,
    fetchedAt: new Date().toISOString(),
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

/** Options for processing a single URL in the batch */
interface SingleUrlProcessOptions {
  readonly extractMainContent: boolean;
  readonly includeMetadata: boolean;
  readonly maxContentLength?: number;
  readonly format: 'jsonl' | 'markdown';
}

/** Result from processing a single URL */
interface SingleUrlResult {
  url: string;
  success: boolean;
  title?: string;
  content?: string;
  contentBlocks?: number;
  cached: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * Attempts to retrieve content from cache for a URL.
 * Returns null if no cache entry exists.
 */
function attemptCacheRetrievalForUrl(
  normalizedUrl: string,
  format: 'jsonl' | 'markdown'
): SingleUrlResult | null {
  const cacheNamespace = format === 'markdown' ? 'markdown' : 'url';
  const cacheKey = cache.createCacheKey(cacheNamespace, normalizedUrl);

  if (!cacheKey) return null;

  const cached = cache.get(cacheKey);
  if (!cached) return null;

  logDebug('Batch cache hit', { url: normalizedUrl });
  return {
    url: normalizedUrl,
    success: true,
    content: cached.content,
    cached: true,
  };
}

/**
 * Transforms HTML content based on format option.
 * Returns content string and optional content block count.
 */
function transformContentForFormat(
  html: string,
  normalizedUrl: string,
  metadata: MetadataBlock | undefined,
  format: 'jsonl' | 'markdown'
): { content: string; contentBlocks?: number } {
  if (format === 'markdown') {
    return {
      content: htmlToMarkdown(html, metadata),
    };
  }

  const blocks = parseHtml(html);
  return {
    content: toJsonl(blocks, metadata),
    contentBlocks: blocks.length,
  };
}

/**
 * Processes content extraction with or without article extraction.
 */
function processContentExtraction(
  html: string,
  normalizedUrl: string,
  options: SingleUrlProcessOptions
): {
  sourceHtml: string;
  title: string | undefined;
  metadata: MetadataBlock | undefined;
} {
  // Fast path: Skip JSDOM when extractMainContent is false
  if (!options.extractMainContent) {
    const extractedMeta = extractMetadata(html);
    return {
      sourceHtml: html,
      title: extractedMeta.title,
      metadata: createContentMetadataBlock(
        normalizedUrl,
        null,
        extractedMeta,
        false,
        options.includeMetadata
      ),
    };
  }

  // Slow path: Use JSDOM for article extraction
  const { article, metadata: extractedMeta } = extractContent(
    html,
    normalizedUrl,
    { extractArticle: true }
  );

  const shouldExtractFromArticle = determineContentExtractionSource(
    true,
    article
  );

  return {
    sourceHtml: shouldExtractFromArticle ? article.content : html,
    title: shouldExtractFromArticle ? article.title : extractedMeta.title,
    metadata: createContentMetadataBlock(
      normalizedUrl,
      article,
      extractedMeta,
      shouldExtractFromArticle,
      options.includeMetadata
    ),
  };
}

/**
 * Processes a single URL: fetch, transform, and cache.
 */
async function processSingleUrl(
  url: string,
  options: SingleUrlProcessOptions
): Promise<SingleUrlResult> {
  try {
    const normalizedUrl = validateAndNormalizeUrl(url);

    // Check cache first
    const cachedResult = attemptCacheRetrievalForUrl(
      normalizedUrl,
      options.format
    );
    if (cachedResult) return cachedResult;

    // Fetch and process content
    const html = await fetchUrlWithRetry(normalizedUrl);

    const { sourceHtml, title, metadata } = processContentExtraction(
      html,
      normalizedUrl,
      options
    );

    const { content, contentBlocks } = transformContentForFormat(
      sourceHtml,
      normalizedUrl,
      metadata,
      options.format
    );

    const { content: finalContent } = enforceContentLengthLimit(
      content,
      options.maxContentLength
    );

    // Cache the result
    const cacheNamespace = options.format === 'markdown' ? 'markdown' : 'url';
    const cacheKey = cache.createCacheKey(cacheNamespace, normalizedUrl);
    if (cacheKey) {
      cache.set(cacheKey, finalContent);
    }

    return {
      url: normalizedUrl,
      success: true,
      title,
      content: finalContent,
      contentBlocks,
      cached: false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorCode =
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'FETCH_ERROR';

    logWarn('Batch URL processing failed', { url, error: errorMessage });

    return {
      url,
      success: false,
      cached: false,
      error: errorMessage,
      errorCode,
    };
  }
}

/**
 * Extracts error message from a rejected promise result.
 */
function extractRejectionMessage(result: PromiseRejectedResult): string {
  // eslint-disable-next-line prefer-destructuring -- explicit type needed for type safety
  const reason: unknown = result.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Validates batch input and returns filtered valid URLs.
 * Returns error response if validation fails.
 */
function validateBatchInput(
  input: FetchUrlsInput
): string[] | FetchUrlsToolResponse {
  if (input.urls.length === 0) {
    return createToolErrorResponse(
      'At least one URL is required',
      '',
      'VALIDATION_ERROR'
    );
  }

  if (input.urls.length > MAX_URLS_PER_BATCH) {
    return createToolErrorResponse(
      `Maximum ${MAX_URLS_PER_BATCH} URLs allowed per batch`,
      '',
      'VALIDATION_ERROR'
    );
  }

  const validUrls = input.urls.filter(
    (url) => typeof url === 'string' && url.trim().length > 0
  );

  if (validUrls.length === 0) {
    return createToolErrorResponse(
      'No valid URLs provided',
      '',
      'VALIDATION_ERROR'
    );
  }

  return validUrls;
}

/**
 * Handles the fetch-urls tool invocation.
 * Fetches multiple URLs in parallel with concurrency control.
 */
export async function fetchUrlsToolHandler(
  input: FetchUrlsInput
): Promise<FetchUrlsToolResponse> {
  try {
    const validationResult = validateBatchInput(input);
    if (!Array.isArray(validationResult)) {
      return validationResult;
    }

    const validUrls = validationResult;
    const concurrency = Math.min(
      Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY),
      MAX_CONCURRENCY
    );
    const continueOnError = input.continueOnError ?? true;
    const format = input.format ?? 'jsonl';

    logDebug('Starting batch URL fetch', {
      urlCount: validUrls.length,
      concurrency,
      format,
    });

    const processOptions: SingleUrlProcessOptions = {
      extractMainContent: input.extractMainContent ?? true,
      includeMetadata: input.includeMetadata ?? true,
      maxContentLength: input.maxContentLength,
      format,
    };

    const tasks = validUrls.map(
      (url) => () => processSingleUrl(url, processOptions)
    );

    const settledResults = await runWithConcurrency(concurrency, tasks, {
      onProgress: (completed, total) => {
        logDebug('Batch progress', {
          completed,
          total,
          percentage: Math.round((completed / total) * 100),
        });
      },
    });

    const results: BatchUrlResult[] = settledResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        url: validUrls[index] ?? 'unknown',
        success: false as const,
        cached: false as const,
        error: extractRejectionMessage(result),
        errorCode: 'PROMISE_REJECTED',
      };
    });

    // Fail fast if continueOnError is false
    if (!continueOnError) {
      const firstError = results.find((result) => !result.success);
      if (firstError && !firstError.success) {
        const errorMsg = firstError.error ?? 'Unknown error';
        return createToolErrorResponse(
          `Batch failed: ${errorMsg}`,
          firstError.url,
          firstError.errorCode ?? 'BATCH_ERROR'
        );
      }
    }

    return createBatchResponse(results);
  } catch (error) {
    logError(
      'fetch-urls tool error',
      error instanceof Error ? error : undefined
    );

    return createToolErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch URLs',
      '',
      'BATCH_ERROR'
    );
  }
}
