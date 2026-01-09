import { TRUNCATION_MARKER } from '../../config/formatting.js';
import { config } from '../../config/index.js';
import type {
  FetchPipelineOptions,
  PipelineResult,
  ToolContentBlock,
} from '../../config/types/runtime.js';

import * as cache from '../../services/cache.js';
import { createCacheKey, toResourceUri } from '../../services/cache-keys.js';
import { fetchNormalizedUrl } from '../../services/fetcher.js';
import { logDebug } from '../../services/logger.js';

import { generateSafeFilename } from '../../utils/filename-generator.js';
import { isRecord } from '../../utils/guards.js';
import { transformToRawUrl } from '../../utils/url-transformer.js';
import { normalizeUrl } from '../../utils/url-validator.js';

interface SharedFetchOptions<T extends { content: string }> {
  readonly url: string;
  readonly transform: (html: string, normalizedUrl: string) => T | Promise<T>;
  readonly serialize?: (result: T) => string;
  readonly deserialize?: (cached: string) => T | undefined;
}

interface SharedFetchDeps {
  readonly executeFetchPipeline?: typeof executeFetchPipeline;
}

function applyOptionalPipelineSerialization<T extends { content: string }>(
  pipelineOptions: FetchPipelineOptions<T>,
  options: SharedFetchOptions<T>
): void {
  if (options.serialize !== undefined) {
    pipelineOptions.serialize = options.serialize;
  }

  if (options.deserialize !== undefined) {
    pipelineOptions.deserialize = options.deserialize;
  }
}

export async function performSharedFetch<T extends { content: string }>(
  options: SharedFetchOptions<T>,
  deps: SharedFetchDeps = {}
): Promise<{
  pipeline: PipelineResult<T>;
  inlineResult: ReturnType<typeof applyInlineContentLimit>;
}> {
  const executePipeline = deps.executeFetchPipeline ?? executeFetchPipeline;

  const pipelineOptions: FetchPipelineOptions<T> = {
    url: options.url,
    cacheNamespace: 'markdown',
    transform: options.transform,
  };

  applyOptionalPipelineSerialization(pipelineOptions, options);

  const pipeline = await executePipeline<T>(pipelineOptions);

  const inlineResult = applyInlineContentLimit(
    pipeline.data.content,
    pipeline.cacheKey ?? null
  );

  return { pipeline, inlineResult };
}

export type InlineResult = ReturnType<typeof applyInlineContentLimit>;

function serializeStructuredContent(
  structuredContent: Record<string, unknown>,
  fromCache: boolean
): string {
  return JSON.stringify(
    structuredContent,
    fromCache ? undefined : null,
    fromCache ? undefined : 2
  );
}

function buildResourceLink(
  inlineResult: InlineResult,
  name: string
): ToolContentBlock | null {
  if (!inlineResult.resourceUri) {
    return null;
  }

  const block: ToolContentBlock = {
    type: 'resource_link',
    uri: inlineResult.resourceUri,
    name,
    description: `Content exceeds inline limit (${config.constants.maxInlineContentChars} chars)`,
  };

  if (inlineResult.resourceMimeType !== undefined) {
    block.mimeType = inlineResult.resourceMimeType;
  }

  return block;
}

function buildEmbeddedResource(
  content: string,
  url: string,
  title?: string
): ToolContentBlock | null {
  if (!content) {
    return null;
  }

  const filename = generateSafeFilename(url, title, undefined, '.md');
  const uri = `file:///${filename}`;

  return {
    type: 'resource',
    resource: {
      uri,
      mimeType: 'text/markdown',
      text: content,
    },
  };
}

function resolveContentToEmbed(
  inlineResult: InlineResult,
  fullContent: string | undefined,
  useInlineInHttpMode: boolean
): unknown {
  if (useInlineInHttpMode) {
    return inlineResult.content;
  }
  return fullContent ?? inlineResult.content;
}

function maybeAppendEmbeddedResource(
  blocks: ToolContentBlock[],
  contentToEmbed: unknown,
  url: string | undefined,
  title: string | undefined
): void {
  if (typeof contentToEmbed !== 'string') return;
  if (!url) return;

  const embeddedResource = buildEmbeddedResource(contentToEmbed, url, title);
  if (embeddedResource) {
    blocks.push(embeddedResource);
  }
}

function maybeAppendResourceLink(
  blocks: ToolContentBlock[],
  inlineResult: InlineResult,
  resourceName: string
): void {
  const resourceLink = buildResourceLink(inlineResult, resourceName);
  if (resourceLink) {
    blocks.push(resourceLink);
  }
}

function buildTextBlock(
  structuredContent: Record<string, unknown>,
  fromCache: boolean
): ToolContentBlock {
  return {
    type: 'text',
    text: serializeStructuredContent(structuredContent, fromCache),
  };
}

export function buildToolContentBlocks(
  structuredContent: Record<string, unknown>,
  fromCache: boolean,
  inlineResult: InlineResult,
  resourceName: string,
  cacheKey?: string | null,
  fullContent?: string,
  url?: string,
  title?: string
): ToolContentBlock[] {
  const blocks: ToolContentBlock[] = [
    buildTextBlock(structuredContent, fromCache),
  ];

  const contentToEmbed = resolveContentToEmbed(
    inlineResult,
    fullContent,
    config.runtime.httpMode
  );
  maybeAppendEmbeddedResource(blocks, contentToEmbed, url, title);
  maybeAppendResourceLink(blocks, inlineResult, resourceName);

  return blocks;
}

interface InlineContentResult {
  content?: string;
  contentSize: number;
  resourceUri?: string;
  resourceMimeType?: string;
  error?: string;
  truncated?: boolean;
}

function applyInlineContentLimit(
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

function attemptCacheRetrieval<T>({
  cacheKey,
  deserialize,
  cacheNamespace,
  normalizedUrl,
}: {
  cacheKey: string | null;
  deserialize: ((cached: string) => T | undefined) | undefined;
  cacheNamespace: string;
  normalizedUrl: string;
}): PipelineResult<T> | null {
  if (!cacheKey) return null;

  const cached = cache.get(cacheKey);
  if (!cached) return null;

  if (!deserialize) {
    logCacheMiss('missing deserializer', cacheNamespace, normalizedUrl);
    return null;
  }

  const data = deserialize(cached.content);
  if (data === undefined) {
    logCacheMiss('deserialize failure', cacheNamespace, normalizedUrl);
    return null;
  }

  logDebug('Cache hit', { namespace: cacheNamespace, url: normalizedUrl });

  return {
    data,
    fromCache: true,
    url: normalizedUrl,
    fetchedAt: cached.fetchedAt,
    cacheKey,
  };
}

function resolveNormalizedUrl(url: string): {
  normalizedUrl: string;
  originalUrl: string;
  transformed: boolean;
} {
  const { normalizedUrl: validatedUrl } = normalizeUrl(url);
  const { url: normalizedUrl, transformed } = transformToRawUrl(validatedUrl);
  return { normalizedUrl, originalUrl: validatedUrl, transformed };
}

export async function executeFetchPipeline<T>(
  options: FetchPipelineOptions<T>
): Promise<PipelineResult<T>> {
  const resolvedUrl = resolveNormalizedUrl(options.url);
  logRawUrlTransformation(resolvedUrl);

  const cacheKey = createCacheKey(
    options.cacheNamespace,
    resolvedUrl.normalizedUrl,
    options.cacheVary
  );
  const cachedResult = attemptCacheRetrieval({
    cacheKey,
    deserialize: options.deserialize,
    cacheNamespace: options.cacheNamespace,
    normalizedUrl: resolvedUrl.normalizedUrl,
  });
  if (cachedResult) return cachedResult;

  logDebug('Fetching URL', { url: resolvedUrl.normalizedUrl });
  const fetchOptions =
    options.signal === undefined ? {} : { signal: options.signal };
  const html = await fetchNormalizedUrl(
    resolvedUrl.normalizedUrl,
    fetchOptions
  );
  const data = await options.transform(html, resolvedUrl.normalizedUrl);

  if (cache.isEnabled()) {
    persistCache({
      cacheKey,
      data,
      serialize: options.serialize,
      normalizedUrl: resolvedUrl.normalizedUrl,
    });
  }

  return {
    data,
    fromCache: false,
    url: resolvedUrl.normalizedUrl,
    fetchedAt: new Date().toISOString(),
    cacheKey,
  };
}

function persistCache<T>({
  cacheKey,
  data,
  serialize,
  normalizedUrl,
}: {
  cacheKey: string | null;
  data: T;
  serialize: ((result: T) => string) | undefined;
  normalizedUrl: string;
}): void {
  if (!cacheKey) return;
  const serializer = serialize ?? JSON.stringify;
  const title = extractTitle(data);
  const metadata = {
    url: normalizedUrl,
    ...(title === undefined ? {} : { title }),
  };
  cache.set(cacheKey, serializer(data), metadata);
}

function extractTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const { title } = value;
  return typeof title === 'string' ? title : undefined;
}

function logCacheMiss(
  reason: string,
  cacheNamespace: string,
  normalizedUrl: string
): void {
  logDebug(`Cache miss due to ${reason}`, {
    namespace: cacheNamespace,
    url: normalizedUrl,
  });
}

function logRawUrlTransformation(resolvedUrl: {
  originalUrl: string;
  transformed: boolean;
}): void {
  if (!resolvedUrl.transformed) return;

  logDebug('Using transformed raw content URL', {
    original: resolvedUrl.originalUrl,
  });
}
