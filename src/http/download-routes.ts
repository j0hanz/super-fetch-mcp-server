import type { Express, Request, Response } from 'express';

import { config } from '../config/index.js';
import type { CacheEntry } from '../config/types/content.js';

import * as cache from '../services/cache.js';
import { logDebug } from '../services/logger.js';

import {
  parseCachedPayload,
  resolveCachedPayloadContent,
} from '../utils/cached-payload.js';
import { generateSafeFilename } from '../utils/filename-generator.js';

const HASH_PATTERN = /^[a-f0-9.]+$/i;

interface DownloadParams {
  namespace: string;
  hash: string;
}

interface DownloadPayload {
  content: string;
  contentType: string;
  fileName: string;
}

function validateNamespace(namespace: string): boolean {
  return namespace === 'markdown';
}

function validateHash(hash: string): boolean {
  return HASH_PATTERN.test(hash) && hash.length >= 8 && hash.length <= 64;
}

function isSingleParam(value: string | string[] | undefined): value is string {
  return typeof value === 'string';
}

function parseDownloadParams(req: Request): DownloadParams | null {
  const { namespace, hash } = req.params;

  if (!isSingleParam(namespace) || !isSingleParam(hash)) return null;
  if (!namespace || !hash) return null;
  if (!validateNamespace(namespace)) return null;
  if (!validateHash(hash)) return null;

  return { namespace, hash };
}

function buildCacheKeyFromParams(params: DownloadParams): string {
  return `${params.namespace}:${params.hash}`;
}

function respondBadRequest(res: Response, message: string): void {
  res.status(400).json({
    error: message,
    code: 'BAD_REQUEST',
  });
}

function respondNotFound(res: Response): void {
  res.status(404).json({
    error: 'Content not found or expired',
    code: 'NOT_FOUND',
  });
}

function respondServiceUnavailable(res: Response): void {
  res.status(503).json({
    error: 'Download service is disabled',
    code: 'SERVICE_UNAVAILABLE',
  });
}

function resolveDownloadPayload(
  params: DownloadParams,
  cacheEntry: CacheEntry
): DownloadPayload | null {
  const payload = parseCachedPayload(cacheEntry.content);
  if (!payload) return null;

  const content = resolveCachedPayloadContent(payload);
  if (!content) return null;

  const safeTitle =
    typeof payload.title === 'string' ? payload.title : undefined;
  const fileName = generateSafeFilename(
    cacheEntry.url,
    cacheEntry.title ?? safeTitle,
    params.hash,
    '.md'
  );

  return {
    content,
    contentType: 'text/markdown; charset=utf-8',
    fileName,
  };
}

function buildContentDisposition(fileName: string): string {
  const encodedName = encodeURIComponent(fileName).replace(/'/g, '%27');
  return `attachment; filename="${fileName}"; filename*=UTF-8''${encodedName}`;
}

function sendDownloadPayload(res: Response, payload: DownloadPayload): void {
  const disposition = buildContentDisposition(payload.fileName);
  res.setHeader('Content-Type', payload.contentType);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', `private, max-age=${config.cache.ttl}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(payload.content);
}

function handleDownload(req: Request, res: Response): void {
  if (!config.cache.enabled) {
    respondServiceUnavailable(res);
    return;
  }

  const params = parseDownloadParams(req);
  if (!params) {
    respondBadRequest(res, 'Invalid namespace or hash format');
    return;
  }

  const cacheKey = buildCacheKeyFromParams(params);
  const cacheEntry = cache.get(cacheKey);

  if (!cacheEntry) {
    logDebug('Download request for missing cache key', { cacheKey });
    respondNotFound(res);
    return;
  }

  const payload = resolveDownloadPayload(params, cacheEntry);
  if (!payload) {
    logDebug('Download payload unavailable', { cacheKey });
    respondNotFound(res);
    return;
  }

  logDebug('Serving download', { cacheKey, fileName: payload.fileName });
  sendDownloadPayload(res, payload);
}

export function registerDownloadRoutes(app: Express): void {
  app.get('/mcp/downloads/:namespace/:hash', handleDownload);
}
