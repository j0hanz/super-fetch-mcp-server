import { randomUUID } from 'node:crypto';
import diagnosticsChannel from 'node:diagnostics_channel';
import dns from 'node:dns';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import type { Dispatcher } from 'undici';
import { Agent } from 'undici';

import { config } from '../config/index.js';
import type { FetchOptions } from '../config/types/runtime.js';

import { FetchError } from '../errors/app-error.js';

import { createErrorWithCode, isSystemError } from '../utils/error-details.js';
import { isRecord } from '../utils/guards.js';
import { redactUrl } from '../utils/url-redactor.js';
import {
  isBlockedIp,
  validateAndNormalizeUrl,
} from '../utils/url-validator.js';

import { getOperationId, getRequestId } from './context.js';
import { logDebug, logError, logWarn } from './logger.js';

const DNS_LOOKUP_TIMEOUT_MS = 5000;

function normalizeLookupResults(
  addresses: string | dns.LookupAddress[],
  family: number | undefined
): dns.LookupAddress[] {
  if (Array.isArray(addresses)) {
    return addresses;
  }

  return [{ address: addresses, family: family ?? 4 }];
}

function findBlockedIpError(
  list: dns.LookupAddress[],
  hostname: string
): NodeJS.ErrnoException | null {
  for (const addr of list) {
    const ip = typeof addr === 'string' ? addr : addr.address;
    if (!isBlockedIp(ip)) {
      continue;
    }

    return createErrorWithCode(
      `Blocked IP detected for ${hostname}`,
      'EBLOCKED'
    );
  }

  return null;
}

function findInvalidFamilyError(
  list: dns.LookupAddress[],
  hostname: string
): NodeJS.ErrnoException | null {
  for (const addr of list) {
    const family = typeof addr === 'string' ? 0 : addr.family;
    if (family === 4 || family === 6) continue;
    return createErrorWithCode(
      `Invalid address family returned for ${hostname}`,
      'EINVAL'
    );
  }

  return null;
}

function createNoDnsResultsError(hostname: string): NodeJS.ErrnoException {
  return createErrorWithCode(
    `No DNS results returned for ${hostname}`,
    'ENODATA'
  );
}

function createEmptySelection(hostname: string): {
  address: string | dns.LookupAddress[];
  family?: number;
  error?: NodeJS.ErrnoException;
  fallback: dns.LookupAddress[];
} {
  return {
    error: createNoDnsResultsError(hostname),
    fallback: [],
    address: [],
  };
}

function selectLookupResult(
  list: dns.LookupAddress[],
  useAll: boolean,
  hostname: string
): {
  address: string | dns.LookupAddress[];
  family?: number;
  error?: NodeJS.ErrnoException;
  fallback: dns.LookupAddress[];
} {
  if (list.length === 0) return createEmptySelection(hostname);

  if (useAll) return { address: list, fallback: list };

  const first = list.at(0);
  if (!first) return createEmptySelection(hostname);

  return {
    address: first.address,
    family: first.family,
    fallback: list,
  };
}

function findLookupError(
  list: dns.LookupAddress[],
  hostname: string
): NodeJS.ErrnoException | null {
  return (
    findInvalidFamilyError(list, hostname) ?? findBlockedIpError(list, hostname)
  );
}

function handleLookupResult(
  error: NodeJS.ErrnoException | null,
  addresses: string | dns.LookupAddress[],
  hostname: string,
  resolvedFamily: number | undefined,
  useAll: boolean,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
): void {
  if (error) {
    callback(error, addresses);
    return;
  }

  const list = normalizeLookupResults(addresses, resolvedFamily);
  const lookupError = findLookupError(list, hostname);
  if (lookupError) {
    callback(lookupError, list);
    return;
  }

  const selection = selectLookupResult(list, useAll, hostname);
  if (selection.error) {
    callback(selection.error, selection.fallback);
    return;
  }

  callback(null, selection.address, selection.family);
}

function resolveDns(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
): void {
  const { normalizedOptions, useAll, resolvedFamily } =
    buildLookupContext(options);
  const lookupOptions = buildLookupOptions(normalizedOptions);

  const timeout = createLookupTimeout(hostname, callback);
  const safeCallback = wrapLookupCallback(callback, timeout);

  dns.lookup(
    hostname,
    lookupOptions,
    createLookupCallback(hostname, resolvedFamily, useAll, safeCallback)
  );
}

function normalizeLookupOptions(
  options: dns.LookupOptions | number
): dns.LookupOptions {
  return typeof options === 'number' ? { family: options } : options;
}

function buildLookupContext(options: dns.LookupOptions | number): {
  normalizedOptions: dns.LookupOptions;
  useAll: boolean;
  resolvedFamily: number | undefined;
} {
  const normalizedOptions = normalizeLookupOptions(options);
  return {
    normalizedOptions,
    useAll: Boolean(normalizedOptions.all),
    resolvedFamily: resolveFamily(normalizedOptions.family),
  };
}

const DEFAULT_DNS_ORDER: dns.LookupOptions['order'] = 'verbatim';

function resolveResultOrder(
  options: dns.LookupOptions
): dns.LookupOptions['order'] {
  if (options.order) return options.order;
  const legacyVerbatim = getLegacyVerbatim(options);
  if (legacyVerbatim !== undefined) {
    return legacyVerbatim ? 'verbatim' : 'ipv4first';
  }
  return DEFAULT_DNS_ORDER;
}

function getLegacyVerbatim(options: dns.LookupOptions): boolean | undefined {
  if (isRecord(options)) {
    const { verbatim } = options;
    return typeof verbatim === 'boolean' ? verbatim : undefined;
  }
  return undefined;
}

function buildLookupOptions(
  normalizedOptions: dns.LookupOptions
): dns.LookupOptions {
  return {
    family: normalizedOptions.family,
    hints: normalizedOptions.hints,
    all: true,
    order: resolveResultOrder(normalizedOptions),
  };
}

function createLookupCallback(
  hostname: string,
  resolvedFamily: number | undefined,
  useAll: boolean,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
): (
  err: NodeJS.ErrnoException | null,
  addresses: string | dns.LookupAddress[]
) => void {
  return (err, addresses) => {
    handleLookupResult(
      err,
      addresses,
      hostname,
      resolvedFamily,
      useAll,
      callback
    );
  };
}

function resolveFamily(
  family: dns.LookupOptions['family']
): number | undefined {
  if (family === 'IPv4') return 4;
  if (family === 'IPv6') return 6;
  return family;
}

function createLookupTimeout(
  hostname: string,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
): {
  isDone: () => boolean;
  markDone: () => void;
} {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    callback(
      createErrorWithCode(`DNS lookup timed out for ${hostname}`, 'ETIMEOUT'),
      []
    );
  }, DNS_LOOKUP_TIMEOUT_MS);
  timer.unref();

  return {
    isDone: (): boolean => done,
    markDone: (): void => {
      done = true;
      clearTimeout(timer);
    },
  };
}

function wrapLookupCallback(
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void,
  timeout: {
    isDone: () => boolean;
    markDone: () => void;
  }
): (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void {
  return (err, address, family): void => {
    if (timeout.isDone()) return;
    timeout.markDone();
    callback(err, address, family);
  };
}

function getAgentOptions(): ConstructorParameters<typeof Agent>[0] {
  const cpuCount = os.availableParallelism();
  return {
    keepAliveTimeout: 60000,
    connections: Math.max(cpuCount * 2, 25),
    pipelining: 1,
    connect: { lookup: resolveDns },
  };
}

export const dispatcher: Dispatcher = new Agent(getAgentOptions());

export function destroyAgents(): void {
  void dispatcher.close();
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 60;
  const parsed = parseInt(header, 10);
  return Number.isNaN(parsed) ? 60 : parsed;
}

function createCanceledError(url: string): FetchError {
  return new FetchError('Request was canceled', url, 499, {
    reason: 'aborted',
  });
}

function createTimeoutError(url: string, timeoutMs: number): FetchError {
  return new FetchError(`Request timeout after ${timeoutMs}ms`, url, 504, {
    timeout: timeoutMs,
  });
}

function createRateLimitError(
  url: string,
  headerValue: string | null
): FetchError {
  const retryAfter = parseRetryAfter(headerValue);
  return new FetchError('Too many requests', url, 429, { retryAfter });
}

function createHttpError(
  url: string,
  status: number,
  statusText: string
): FetchError {
  return new FetchError(`HTTP ${status}: ${statusText}`, url, status);
}

function createNetworkError(url: string, message?: string): FetchError {
  const details = message ? { message } : undefined;
  return new FetchError(
    `Network error: Could not reach ${url}`,
    url,
    undefined,
    details ?? {}
  );
}

function createUnknownError(url: string, message: string): FetchError {
  return new FetchError(message, url);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function getRequestUrl(record: Record<string, unknown>): string | null {
  const value = record.requestUrl;
  return typeof value === 'string' ? value : null;
}

function resolveErrorUrl(error: unknown, fallback: string): string {
  if (error instanceof FetchError) return error.url;
  if (!isRecord(error)) return fallback;
  const requestUrl = getRequestUrl(error);
  if (requestUrl) return requestUrl;
  return fallback;
}

function mapFetchError(
  error: unknown,
  fallbackUrl: string,
  timeoutMs: number
): FetchError {
  if (error instanceof FetchError) return error;

  const url = resolveErrorUrl(error, fallbackUrl);

  if (isAbortError(error)) {
    if (isTimeoutError(error)) {
      return createTimeoutError(url, timeoutMs);
    }
    return createCanceledError(url);
  }

  if (error instanceof Error) {
    return createNetworkError(url, error.message);
  }

  return createUnknownError(url, 'Unexpected error');
}

type FetchChannelEvent =
  | {
      v: 1;
      type: 'start';
      requestId: string;
      method: string;
      url: string;
      contextRequestId?: string;
      operationId?: string;
    }
  | {
      v: 1;
      type: 'end';
      requestId: string;
      status: number;
      duration: number;
      contextRequestId?: string;
      operationId?: string;
    }
  | {
      v: 1;
      type: 'error';
      requestId: string;
      url: string;
      error: string;
      code?: string;
      status?: number;
      duration: number;
      contextRequestId?: string;
      operationId?: string;
    };

const fetchChannel = diagnosticsChannel.channel('superfetch.fetch');

function publishFetchEvent(event: FetchChannelEvent): void {
  if (!fetchChannel.hasSubscribers) return;
  try {
    fetchChannel.publish(event);
  } catch {
    // Avoid crashing the publisher if a subscriber throws.
  }
}

interface FetchTelemetryContext {
  requestId: string;
  startTime: number;
  url: string;
  method: string;
  contextRequestId?: string;
  operationId?: string;
}

export function startFetchTelemetry(
  url: string,
  method: string
): FetchTelemetryContext {
  const safeUrl = redactUrl(url);
  const contextRequestId = getRequestId();
  const operationId = getOperationId();
  const context: FetchTelemetryContext = {
    requestId: randomUUID(),
    startTime: performance.now(),
    url: safeUrl,
    method: method.toUpperCase(),
    ...(contextRequestId ? { contextRequestId } : {}),
    ...(operationId ? { operationId } : {}),
  };

  publishFetchEvent({
    v: 1,
    type: 'start',
    requestId: context.requestId,
    method: context.method,
    url: context.url,
    ...(context.contextRequestId
      ? { contextRequestId: context.contextRequestId }
      : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
  });

  logDebug('HTTP Request', {
    requestId: context.requestId,
    method: context.method,
    url: context.url,
    ...(context.contextRequestId
      ? { contextRequestId: context.contextRequestId }
      : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
  });

  return context;
}

export function recordFetchResponse(
  context: FetchTelemetryContext,
  response: Response,
  contentSize?: number
): void {
  const duration = performance.now() - context.startTime;
  const durationLabel = `${Math.round(duration)}ms`;
  publishFetchEvent({
    v: 1,
    type: 'end',
    requestId: context.requestId,
    status: response.status,
    duration,
    ...(context.contextRequestId
      ? { contextRequestId: context.contextRequestId }
      : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
  });

  const contentType = response.headers.get('content-type');
  const contentLength =
    response.headers.get('content-length') ??
    (contentSize === undefined ? undefined : String(contentSize));

  logDebug('HTTP Response', {
    requestId: context.requestId,
    status: response.status,
    url: context.url,
    duration: durationLabel,
    ...(context.contextRequestId
      ? { contextRequestId: context.contextRequestId }
      : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
    ...(contentType ? { contentType } : {}),
    ...(contentLength ? { size: contentLength } : {}),
  });

  if (duration > 5000) {
    logWarn('Slow HTTP request detected', {
      requestId: context.requestId,
      url: context.url,
      duration: durationLabel,
      ...(context.contextRequestId
        ? { contextRequestId: context.contextRequestId }
        : {}),
      ...(context.operationId ? { operationId: context.operationId } : {}),
    });
  }
}

export function recordFetchError(
  context: FetchTelemetryContext,
  error: unknown,
  status?: number
): void {
  const duration = performance.now() - context.startTime;
  const err = error instanceof Error ? error : new Error(String(error));

  const event: FetchChannelEvent = {
    v: 1,
    type: 'error',
    requestId: context.requestId,
    url: context.url,
    error: err.message,
    duration,
    ...(context.contextRequestId
      ? { contextRequestId: context.contextRequestId }
      : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
  };

  const code = isSystemError(err) ? err.code : undefined;
  if (code !== undefined) {
    event.code = code;
  }
  if (status !== undefined) {
    event.status = status;
  }

  publishFetchEvent(event);

  const log = status === 429 ? logWarn : logError;
  log('HTTP Request Error', {
    requestId: context.requestId,
    url: context.url,
    status,
    code,
    error: err.message,
    ...(context.contextRequestId
      ? { contextRequestId: context.contextRequestId }
      : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

function cancelResponseBody(response: Response): void {
  const cancelPromise = response.body?.cancel();
  if (cancelPromise) {
    cancelPromise.catch(() => {
      // Best-effort cancellation; ignore failures.
    });
  }
}

interface FetchCycleResult {
  response: Response;
  nextUrl?: string;
}

async function performFetchCycle(
  currentUrl: string,
  init: RequestInit,
  redirectLimit: number,
  redirectCount: number
): Promise<FetchCycleResult> {
  const response = await fetch(currentUrl, { ...init, redirect: 'manual' });

  if (!isRedirectStatus(response.status)) {
    return { response };
  }

  assertRedirectWithinLimit(response, currentUrl, redirectLimit, redirectCount);
  const location = getRedirectLocation(response, currentUrl);

  cancelResponseBody(response);
  return {
    response,
    nextUrl: resolveRedirectTarget(currentUrl, location),
  };
}

function assertRedirectWithinLimit(
  response: Response,
  currentUrl: string,
  redirectLimit: number,
  redirectCount: number
): void {
  if (redirectCount < redirectLimit) return;
  cancelResponseBody(response);
  throw new FetchError('Too many redirects', currentUrl);
}

function getRedirectLocation(response: Response, currentUrl: string): string {
  const location = response.headers.get('location');
  if (location) return location;

  cancelResponseBody(response);
  throw new FetchError('Redirect response missing Location header', currentUrl);
}

function annotateRedirectError(error: unknown, url: string): void {
  if (!isRecord(error)) return;
  error.requestUrl = url;
}

function resolveRedirectTarget(baseUrl: string, location: string): string {
  if (!URL.canParse(location, baseUrl)) {
    throw createErrorWithCode('Invalid redirect target', 'EBADREDIRECT');
  }

  const resolved = new URL(location, baseUrl);
  if (resolved.username || resolved.password) {
    throw createErrorWithCode(
      'Redirect target includes credentials',
      'EBADREDIRECT'
    );
  }

  return validateAndNormalizeUrl(resolved.href);
}

export async function fetchWithRedirects(
  url: string,
  init: RequestInit,
  maxRedirects: number
): Promise<{ response: Response; url: string }> {
  let currentUrl = url;
  const redirectLimit = Math.max(0, maxRedirects);

  for (
    let redirectCount = 0;
    redirectCount <= redirectLimit;
    redirectCount += 1
  ) {
    const { response, nextUrl } = await performFetchCycleSafely(
      currentUrl,
      init,
      redirectLimit,
      redirectCount
    );

    if (!nextUrl) {
      return { response, url: currentUrl };
    }

    currentUrl = nextUrl;
  }

  throw new FetchError('Too many redirects', currentUrl);
}

async function performFetchCycleSafely(
  currentUrl: string,
  init: RequestInit,
  redirectLimit: number,
  redirectCount: number
): Promise<FetchCycleResult> {
  try {
    return await performFetchCycle(
      currentUrl,
      init,
      redirectLimit,
      redirectCount
    );
  } catch (error) {
    annotateRedirectError(error, currentUrl);
    throw error;
  }
}

function assertContentLengthWithinLimit(
  response: Response,
  url: string,
  maxBytes: number
): void {
  const contentLengthHeader = response.headers.get('content-length');
  if (!contentLengthHeader) return;
  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (Number.isNaN(contentLength) || contentLength <= maxBytes) {
    return;
  }

  cancelResponseBody(response);

  throw new FetchError(
    `Response exceeds maximum size of ${maxBytes} bytes`,
    url
  );
}

interface StreamReadState {
  decoder: TextDecoder;
  parts: string[];
  total: number;
}

function createReadState(): StreamReadState {
  return {
    decoder: new TextDecoder(),
    parts: [],
    total: 0,
  };
}

function appendChunk(
  state: StreamReadState,
  chunk: Uint8Array,
  maxBytes: number,
  url: string
): void {
  state.total += chunk.byteLength;
  if (state.total > maxBytes) {
    throw new FetchError(
      `Response exceeds maximum size of ${maxBytes} bytes`,
      url
    );
  }

  const decoded = state.decoder.decode(chunk, { stream: true });
  if (decoded) state.parts.push(decoded);
}

function finalizeRead(state: StreamReadState): void {
  const decoded = state.decoder.decode();
  if (decoded) state.parts.push(decoded);
}

function createAbortError(url: string): FetchError {
  return new FetchError('Request was aborted during response read', url, 499, {
    reason: 'aborted',
  });
}

async function cancelReaderQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Ignore cancel errors; we're already failing this read.
  }
}

async function throwIfAborted(
  signal: AbortSignal | undefined,
  url: string,
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  if (!signal?.aborted) return;
  await cancelReaderQuietly(reader);
  throw createAbortError(url);
}

async function handleReadFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  url: string,
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<never> {
  const aborted = signal?.aborted ?? false;
  await cancelReaderQuietly(reader);
  if (aborted) {
    throw createAbortError(url);
  }
  throw error;
}

async function readAllChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: StreamReadState,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<void> {
  await throwIfAborted(signal, url, reader);

  let result = await reader.read();
  while (!result.done) {
    appendChunk(state, result.value, maxBytes, url);
    await throwIfAborted(signal, url, reader);
    result = await reader.read();
  }
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; size: number }> {
  const state = createReadState();
  const reader = stream.getReader();

  try {
    await readAllChunks(reader, state, url, maxBytes, signal);
  } catch (error) {
    await handleReadFailure(error, signal, url, reader);
  } finally {
    reader.releaseLock();
  }

  finalizeRead(state);
  return { text: state.parts.join(''), size: state.total };
}

export async function readResponseText(
  response: Response,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; size: number }> {
  assertContentLengthWithinLimit(response, url, maxBytes);

  if (!response.body) {
    const text = await response.text();
    const size = Buffer.byteLength(text);
    if (size > maxBytes) {
      throw new FetchError(
        `Response exceeds maximum size of ${maxBytes} bytes`,
        url
      );
    }
    return { text, size };
  }

  return readStreamWithLimit(response.body, url, maxBytes, signal);
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': config.fetcher.userAgent,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
};

function buildHeaders(): Record<string, string> {
  return { ...DEFAULT_HEADERS };
}

function buildRequestSignal(
  timeoutMs: number,
  external?: AbortSignal
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!external) return timeoutSignal;
  return AbortSignal.any([external, timeoutSignal]);
}

function buildRequestInit(
  headers: HeadersInit,
  signal: AbortSignal
): RequestInit & { dispatcher: Dispatcher } {
  return {
    method: 'GET',
    headers,
    signal,
    dispatcher,
  };
}

function resolveResponseError(
  response: Response,
  finalUrl: string
): FetchError | null {
  return (
    resolveRateLimitError(response, finalUrl) ??
    resolveHttpError(response, finalUrl)
  );
}

function resolveRateLimitError(
  response: Response,
  finalUrl: string
): FetchError | null {
  return response.status === 429
    ? createRateLimitError(finalUrl, response.headers.get('retry-after'))
    : null;
}

function resolveHttpError(
  response: Response,
  finalUrl: string
): FetchError | null {
  return response.ok
    ? null
    : createHttpError(finalUrl, response.status, response.statusText);
}

async function handleFetchResponse(
  response: Response,
  finalUrl: string,
  telemetry: FetchTelemetryContext,
  signal?: AbortSignal
): Promise<string> {
  const responseError = resolveResponseError(response, finalUrl);
  if (responseError) {
    cancelResponseBody(response);
    throw responseError;
  }

  const { text, size } = await readResponseText(
    response,
    finalUrl,
    config.fetcher.maxContentLength,
    signal
  );
  recordFetchResponse(telemetry, response, size);
  return text;
}

async function fetchWithTelemetry(
  normalizedUrl: string,
  requestInit: RequestInit,
  timeoutMs: number
): Promise<string> {
  const telemetry = startFetchTelemetry(normalizedUrl, 'GET');

  try {
    return await fetchAndHandle(normalizedUrl, requestInit, telemetry);
  } catch (error) {
    const mapped = mapFetchError(error, normalizedUrl, timeoutMs);
    telemetry.url = mapped.url;
    recordFetchError(telemetry, mapped, mapped.statusCode);
    throw mapped;
  }
}

async function fetchAndHandle(
  normalizedUrl: string,
  requestInit: RequestInit,
  telemetry: FetchTelemetryContext
): Promise<string> {
  const { response, url: finalUrl } = await fetchWithRedirects(
    normalizedUrl,
    requestInit,
    config.fetcher.maxRedirects
  );

  telemetry.url = finalUrl;
  return handleFetchResponse(
    response,
    finalUrl,
    telemetry,
    requestInit.signal ?? undefined
  );
}

export async function fetchNormalizedUrl(
  normalizedUrl: string,
  options?: FetchOptions
): Promise<string> {
  const timeoutMs = config.fetcher.timeout;
  const headers = buildHeaders();
  const signal = buildRequestSignal(timeoutMs, options?.signal);
  const requestInit = buildRequestInit(headers, signal);
  return fetchWithTelemetry(normalizedUrl, requestInit, timeoutMs);
}
