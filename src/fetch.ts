import { randomUUID } from 'node:crypto';
import diagnosticsChannel from 'node:diagnostics_channel';
import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import type { Dispatcher } from 'undici';
import { Agent } from 'undici';

import { config } from './config.js';
import { createErrorWithCode, FetchError, isSystemError } from './errors.js';
import {
  getOperationId,
  getRequestId,
  logDebug,
  logError,
  logWarn,
  redactUrl,
} from './observability.js';
import { isObject } from './type-guards.js';

/* -------------------------------------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------------------------------------- */

export interface FetchOptions {
  signal?: AbortSignal;
}

export interface TransformResult {
  readonly url: string;
  readonly transformed: boolean;
  readonly platform?: string;
}

/* -------------------------------------------------------------------------------------------------
 * SSRF / IP blocking
 * ------------------------------------------------------------------------------------------------- */

type IpSegment = number | string;

function buildIpv4(parts: readonly [number, number, number, number]): string {
  return parts.join('.');
}

function buildIpv6(parts: readonly IpSegment[]): string {
  return parts.map(String).join(':');
}

const IPV6_ZERO = buildIpv6([0, 0, 0, 0, 0, 0, 0, 0]);
const IPV6_LOOPBACK = buildIpv6([0, 0, 0, 0, 0, 0, 0, 1]);
const IPV6_64_FF9B = buildIpv6(['64', 'ff9b', 0, 0, 0, 0, 0, 0]);
const IPV6_64_FF9B_1 = buildIpv6(['64', 'ff9b', 1, 0, 0, 0, 0, 0]);
const IPV6_2001 = buildIpv6(['2001', 0, 0, 0, 0, 0, 0, 0]);
const IPV6_2002 = buildIpv6(['2002', 0, 0, 0, 0, 0, 0, 0]);
const IPV6_FC00 = buildIpv6(['fc00', 0, 0, 0, 0, 0, 0, 0]);
const IPV6_FE80 = buildIpv6(['fe80', 0, 0, 0, 0, 0, 0, 0]);
const IPV6_FF00 = buildIpv6(['ff00', 0, 0, 0, 0, 0, 0, 0]);

const BLOCKED_IPV4_SUBNETS: readonly { subnet: string; prefix: number }[] = [
  { subnet: buildIpv4([0, 0, 0, 0]), prefix: 8 },
  { subnet: buildIpv4([10, 0, 0, 0]), prefix: 8 },
  { subnet: buildIpv4([100, 64, 0, 0]), prefix: 10 },
  { subnet: buildIpv4([127, 0, 0, 0]), prefix: 8 },
  { subnet: buildIpv4([169, 254, 0, 0]), prefix: 16 },
  { subnet: buildIpv4([172, 16, 0, 0]), prefix: 12 },
  { subnet: buildIpv4([192, 168, 0, 0]), prefix: 16 },
  { subnet: buildIpv4([224, 0, 0, 0]), prefix: 4 },
  { subnet: buildIpv4([240, 0, 0, 0]), prefix: 4 },
];

const BLOCKED_IPV6_SUBNETS: readonly { subnet: string; prefix: number }[] = [
  { subnet: IPV6_ZERO, prefix: 128 },
  { subnet: IPV6_LOOPBACK, prefix: 128 },
  { subnet: IPV6_64_FF9B, prefix: 96 },
  { subnet: IPV6_64_FF9B_1, prefix: 48 },
  { subnet: IPV6_2001, prefix: 32 },
  { subnet: IPV6_2002, prefix: 16 },
  { subnet: IPV6_FC00, prefix: 7 },
  { subnet: IPV6_FE80, prefix: 10 },
  { subnet: IPV6_FF00, prefix: 8 },
];

class IpBlocker {
  private cachedBlockList: BlockList | undefined;

  isBlockedIp(candidate: string): boolean {
    if (config.security.blockedHosts.has(candidate)) return true;

    const ipType = this.resolveIpType(candidate);
    if (!ipType) return false;

    const normalized = candidate.toLowerCase();
    if (this.isBlockedBySubnetList(normalized, ipType)) return true;

    return (
      config.security.blockedIpPattern.test(normalized) ||
      config.security.blockedIpv4MappedPattern.test(normalized)
    );
  }

  private resolveIpType(ip: string): 4 | 6 | null {
    const ipType = isIP(ip);
    return ipType === 4 || ipType === 6 ? ipType : null;
  }

  private isBlockedBySubnetList(ip: string, ipType: 4 | 6): boolean {
    const list = this.getBlockList();
    return ipType === 4 ? list.check(ip, 'ipv4') : list.check(ip, 'ipv6');
  }

  private getBlockList(): BlockList {
    if (!this.cachedBlockList) {
      const list = new BlockList();
      for (const entry of BLOCKED_IPV4_SUBNETS)
        list.addSubnet(entry.subnet, entry.prefix, 'ipv4');
      for (const entry of BLOCKED_IPV6_SUBNETS)
        list.addSubnet(entry.subnet, entry.prefix, 'ipv6');
      this.cachedBlockList = list;
    }
    return this.cachedBlockList;
  }
}

const ipBlocker = new IpBlocker();

/** Backwards-compatible export */
export function isBlockedIp(ip: string): boolean {
  return ipBlocker.isBlockedIp(ip);
}

/* -------------------------------------------------------------------------------------------------
 * URL normalization & hostname policy
 * ------------------------------------------------------------------------------------------------- */

const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';

function createValidationError(message: string): Error {
  return createErrorWithCode(message, VALIDATION_ERROR_CODE);
}

const BLOCKED_HOST_SUFFIXES: readonly string[] = ['.local', '.internal'];

class UrlNormalizer {
  normalize(urlString: string): { normalizedUrl: string; hostname: string } {
    const trimmedUrl = this.requireTrimmedUrl(urlString);
    this.assertUrlLength(trimmedUrl);

    const url = this.parseUrl(trimmedUrl);
    this.assertHttpProtocol(url);
    this.assertNoCredentials(url);

    const hostname = this.normalizeHostname(url);
    this.assertHostnameAllowed(hostname);

    // Canonicalize hostname to avoid trailing-dot variants and keep url.href consistent.
    url.hostname = hostname;

    return { normalizedUrl: url.href, hostname };
  }

  validateAndNormalize(urlString: string): string {
    return this.normalize(urlString).normalizedUrl;
  }

  private requireTrimmedUrl(urlString: string): string {
    if (!urlString || typeof urlString !== 'string') {
      throw createValidationError('URL is required');
    }

    const trimmed = urlString.trim();
    if (!trimmed) throw createValidationError('URL cannot be empty');
    return trimmed;
  }

  private assertUrlLength(url: string): void {
    if (url.length <= config.constants.maxUrlLength) return;
    throw createValidationError(
      `URL exceeds maximum length of ${config.constants.maxUrlLength} characters`
    );
  }

  private parseUrl(urlString: string): URL {
    if (!URL.canParse(urlString))
      throw createValidationError('Invalid URL format');
    return new URL(urlString);
  }

  private assertHttpProtocol(url: URL): void {
    if (url.protocol === 'http:' || url.protocol === 'https:') return;
    throw createValidationError(
      `Invalid protocol: ${url.protocol}. Only http: and https: are allowed`
    );
  }

  private assertNoCredentials(url: URL): void {
    if (!url.username && !url.password) return;
    throw createValidationError(
      'URLs with embedded credentials are not allowed'
    );
  }

  private normalizeHostname(url: URL): string {
    let hostname = url.hostname.toLowerCase();
    while (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
    if (!hostname)
      throw createValidationError('URL must have a valid hostname');
    return hostname;
  }

  private assertHostnameAllowed(hostname: string): void {
    this.assertNotBlockedHost(hostname);
    this.assertNotBlockedIp(hostname);
    this.assertNotBlockedHostnameSuffix(hostname);
  }

  private assertNotBlockedHost(hostname: string): void {
    if (!config.security.blockedHosts.has(hostname)) return;
    throw createValidationError(
      `Blocked host: ${hostname}. Internal hosts are not allowed`
    );
  }

  private assertNotBlockedIp(hostname: string): void {
    if (!ipBlocker.isBlockedIp(hostname)) return;
    throw createValidationError(
      `Blocked IP range: ${hostname}. Private IPs are not allowed`
    );
  }

  private assertNotBlockedHostnameSuffix(hostname: string): void {
    const blocked = BLOCKED_HOST_SUFFIXES.some((suffix) =>
      hostname.endsWith(suffix)
    );
    if (!blocked) return;
    throw createValidationError(
      `Blocked hostname pattern: ${hostname}. Internal domain suffixes are not allowed`
    );
  }
}

const urlNormalizer = new UrlNormalizer();

/** Backwards-compatible exports */
export function normalizeUrl(urlString: string): {
  normalizedUrl: string;
  hostname: string;
} {
  return urlNormalizer.normalize(urlString);
}

export function validateAndNormalizeUrl(urlString: string): string {
  return urlNormalizer.validateAndNormalize(urlString);
}

/* -------------------------------------------------------------------------------------------------
 * Raw URL transformation
 * ------------------------------------------------------------------------------------------------- */

interface TransformRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly transform: (match: RegExpExecArray) => string;
}

const GITHUB_BLOB_RULE: TransformRule = {
  name: 'github',
  pattern:
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
  transform: (match) => {
    const owner = match[1] ?? '';
    const repo = match[2] ?? '';
    const branch = match[3] ?? '';
    const path = match[4] ?? '';
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  },
};

const GITHUB_GIST_RULE: TransformRule = {
  name: 'github-gist',
  pattern:
    /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)(?:#file-(.+)|\/raw\/([^/]+))?$/i,
  transform: (match) => {
    const user = match[1] ?? '';
    const gistId = match[2] ?? '';
    const hashFile = match[3];
    const rawFile = match[4];
    const filename = rawFile ?? hashFile?.replace(/-/g, '.');
    const filePath = filename ? `/${filename}` : '';
    return `https://gist.githubusercontent.com/${user}/${gistId}/raw${filePath}`;
  },
};

const GITLAB_BLOB_RULE: TransformRule = {
  name: 'gitlab',
  pattern:
    /^(https?:\/\/(?:[^/]+\.)?gitlab\.com\/[^/]+\/[^/]+)\/-\/blob\/([^/]+)\/(.+)$/i,
  transform: (match) => {
    const baseUrl = match[1] ?? '';
    const branch = match[2] ?? '';
    const path = match[3] ?? '';
    return `${baseUrl}/-/raw/${branch}/${path}`;
  },
};

const BITBUCKET_SRC_RULE: TransformRule = {
  name: 'bitbucket',
  pattern:
    /^(https?:\/\/(?:www\.)?bitbucket\.org\/[^/]+\/[^/]+)\/src\/([^/]+)\/(.+)$/i,
  transform: (match) => {
    const baseUrl = match[1] ?? '';
    const branch = match[2] ?? '';
    const path = match[3] ?? '';
    return `${baseUrl}/raw/${branch}/${path}`;
  },
};

const TRANSFORM_RULES: readonly TransformRule[] = [
  GITHUB_BLOB_RULE,
  GITHUB_GIST_RULE,
  GITLAB_BLOB_RULE,
  BITBUCKET_SRC_RULE,
];

const BITBUCKET_RAW_RE = /bitbucket\.org\/[^/]+\/[^/]+\/raw\//;

const RAW_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.rst',
  '.adoc',
  '.org',
]);

class RawUrlTransformer {
  transformToRawUrl(url: string): TransformResult {
    if (!url) return { url, transformed: false };
    if (this.isRawUrl(url)) return { url, transformed: false };

    const { base, hash } = this.splitParams(url);
    const result = this.applyRules(base, hash);
    if (!result) return { url, transformed: false };

    logDebug('URL transformed to raw content URL', {
      platform: result.platform,
      original: url.substring(0, 100),
      transformed: result.url.substring(0, 100),
    });

    return { url: result.url, transformed: true, platform: result.platform };
  }

  isRawTextContentUrl(url: string): boolean {
    if (!url) return false;
    if (this.isRawUrl(url)) return true;

    const { base } = this.splitParams(url);
    const lowerBase = base.toLowerCase();
    const lastDot = lowerBase.lastIndexOf('.');
    if (lastDot === -1) return false;

    return RAW_TEXT_EXTENSIONS.has(lowerBase.slice(lastDot));
  }

  private isRawUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('raw.githubusercontent.com') ||
      lower.includes('gist.githubusercontent.com') ||
      lower.includes('/-/raw/') ||
      BITBUCKET_RAW_RE.test(lower)
    );
  }

  private splitParams(url: string): { base: string; hash: string } {
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    const endIndex = Math.min(
      queryIndex === -1 ? url.length : queryIndex,
      hashIndex === -1 ? url.length : hashIndex
    );

    const hash = hashIndex !== -1 ? url.slice(hashIndex) : '';
    return { base: url.slice(0, endIndex), hash };
  }

  private applyRules(
    base: string,
    hash: string
  ): { url: string; platform: string } | null {
    for (const rule of TRANSFORM_RULES) {
      const urlToMatch =
        rule.name === 'github-gist' && hash.startsWith('#file-')
          ? base + hash
          : base;
      const match = rule.pattern.exec(urlToMatch);
      if (match) return { url: rule.transform(match), platform: rule.name };
    }
    return null;
  }
}

const rawUrlTransformer = new RawUrlTransformer();

/** Backwards-compatible exports */
export function transformToRawUrl(url: string): TransformResult {
  return rawUrlTransformer.transformToRawUrl(url);
}

export function isRawTextContentUrl(url: string): boolean {
  return rawUrlTransformer.isRawTextContentUrl(url);
}

/* -------------------------------------------------------------------------------------------------
 * Safe DNS lookup for undici Agent
 * ------------------------------------------------------------------------------------------------- */

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

const DNS_LOOKUP_TIMEOUT_MS = 5000;

class SafeDnsLookup {
  lookup(
    hostname: string,
    options: dns.LookupOptions | number,
    callback: LookupCallback
  ): void {
    const normalizedOptions = this.normalizeOptions(options);
    const useAll = Boolean(normalizedOptions.all);
    const resolvedFamily = this.resolveFamily(normalizedOptions.family);

    const lookupOptions: dns.LookupOptions = {
      family: normalizedOptions.family,
      hints: normalizedOptions.hints,
      all: true, // Always request all results; we select based on caller preference.
      order: this.resolveOrder(normalizedOptions),
    };

    const timeout = this.createTimeout(hostname, callback);
    const safeCallback: LookupCallback = (err, address, family) => {
      if (timeout.isDone()) return;
      timeout.markDone();
      callback(err, address, family);
    };

    (async () => {
      try {
        const result = await dns.promises.lookup(hostname, lookupOptions);
        const addresses = Array.isArray(result) ? result : [result];
        this.handleLookupResult(
          null,
          addresses,
          hostname,
          resolvedFamily,
          useAll,
          safeCallback
        );
      } catch (error: unknown) {
        this.handleLookupResult(
          error as NodeJS.ErrnoException,
          [],
          hostname,
          resolvedFamily,
          useAll,
          safeCallback
        );
      }
    })().catch((error: unknown) => {
      if (!timeout.isDone()) {
        safeCallback(error as NodeJS.ErrnoException, []);
      }
    });
  }

  private normalizeOptions(
    options: dns.LookupOptions | number
  ): dns.LookupOptions {
    return typeof options === 'number' ? { family: options } : options;
  }

  private resolveFamily(
    family: dns.LookupOptions['family']
  ): number | undefined {
    if (family === 'IPv4') return 4;
    if (family === 'IPv6') return 6;
    return family;
  }

  private resolveOrder(options: dns.LookupOptions): dns.LookupOptions['order'] {
    if (options.order) return options.order;

    // legacy `verbatim` option support
    if (isObject(options)) {
      const legacy = (options as { verbatim?: unknown }).verbatim;
      if (typeof legacy === 'boolean') return legacy ? 'verbatim' : 'ipv4first';
    }

    return 'verbatim';
  }

  private handleLookupResult(
    error: NodeJS.ErrnoException | null,
    addresses: string | dns.LookupAddress[],
    hostname: string,
    resolvedFamily: number | undefined,
    useAll: boolean,
    callback: LookupCallback
  ): void {
    if (error) {
      callback(error, addresses);
      return;
    }

    const list = this.normalizeResults(addresses, resolvedFamily);
    const validationError = this.validateResults(list, hostname);
    if (validationError) {
      callback(validationError, list);
      return;
    }

    const selection = this.selectResult(list, useAll, hostname);
    if (selection.error) {
      callback(selection.error, selection.fallback);
      return;
    }

    callback(null, selection.address, selection.family);
  }

  private normalizeResults(
    addresses: string | dns.LookupAddress[],
    family: number | undefined
  ): dns.LookupAddress[] {
    if (Array.isArray(addresses)) return addresses;
    return [{ address: addresses, family: family ?? 4 }];
  }

  private validateResults(
    list: dns.LookupAddress[],
    hostname: string
  ): NodeJS.ErrnoException | null {
    if (list.length === 0) {
      return createErrorWithCode(
        `No DNS results returned for ${hostname}`,
        'ENODATA'
      );
    }

    for (const addr of list) {
      if (addr.family !== 4 && addr.family !== 6) {
        return createErrorWithCode(
          `Invalid address family returned for ${hostname}`,
          'EINVAL'
        );
      }
      if (ipBlocker.isBlockedIp(addr.address)) {
        return createErrorWithCode(
          `Blocked IP detected for ${hostname}`,
          'EBLOCKED'
        );
      }
    }

    return null;
  }

  private selectResult(
    list: dns.LookupAddress[],
    useAll: boolean,
    hostname: string
  ): {
    address: string | dns.LookupAddress[];
    family?: number;
    error?: NodeJS.ErrnoException;
    fallback: dns.LookupAddress[];
  } {
    if (list.length === 0) {
      return {
        error: createErrorWithCode(
          `No DNS results returned for ${hostname}`,
          'ENODATA'
        ),
        fallback: [],
        address: [],
      };
    }

    if (useAll) return { address: list, fallback: list };

    const first = list.at(0);
    if (!first) {
      return {
        error: createErrorWithCode(
          `No DNS results returned for ${hostname}`,
          'ENODATA'
        ),
        fallback: [],
        address: [],
      };
    }

    return { address: first.address, family: first.family, fallback: list };
  }

  private createTimeout(
    hostname: string,
    callback: LookupCallback
  ): { isDone: () => boolean; markDone: () => void } {
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
      isDone: () => done,
      markDone: () => {
        done = true;
        clearTimeout(timer);
      },
    };
  }
}

const safeDns = new SafeDnsLookup();

/* -------------------------------------------------------------------------------------------------
 * Dispatcher / Agent lifecycle
 * ------------------------------------------------------------------------------------------------- */

function getAgentOptions(): ConstructorParameters<typeof Agent>[0] {
  const cpuCount = os.availableParallelism();
  return {
    keepAliveTimeout: 60000,
    connections: Math.max(cpuCount * 2, 25),
    pipelining: 1,
    connect: { lookup: safeDns.lookup.bind(safeDns) },
  };
}

export const dispatcher: Dispatcher = new Agent(getAgentOptions());

export function destroyAgents(): void {
  void dispatcher.close();
}

/* -------------------------------------------------------------------------------------------------
 * Fetch error mapping (request-level)
 * ------------------------------------------------------------------------------------------------- */

function parseRetryAfter(header: string | null): number {
  if (!header) return 60;
  const parsed = Number.parseInt(header, 10);
  return Number.isNaN(parsed) ? 60 : parsed;
}

class FetchErrorFactory {
  canceled(url: string): FetchError {
    return new FetchError('Request was canceled', url, 499, {
      reason: 'aborted',
    });
  }

  timeout(url: string, timeoutMs: number): FetchError {
    return new FetchError(`Request timeout after ${timeoutMs}ms`, url, 504, {
      timeout: timeoutMs,
    });
  }

  rateLimited(url: string, retryAfterHeader: string | null): FetchError {
    return new FetchError('Too many requests', url, 429, {
      retryAfter: parseRetryAfter(retryAfterHeader),
    });
  }

  http(url: string, status: number, statusText: string): FetchError {
    return new FetchError(`HTTP ${status}: ${statusText}`, url, status);
  }

  tooManyRedirects(url: string): FetchError {
    return new FetchError('Too many redirects', url);
  }

  missingRedirectLocation(url: string): FetchError {
    return new FetchError('Redirect response missing Location header', url);
  }

  sizeLimit(url: string, maxBytes: number): FetchError {
    return new FetchError(
      `Response exceeds maximum size of ${maxBytes} bytes`,
      url
    );
  }

  network(url: string, message?: string): FetchError {
    return new FetchError(
      `Network error: Could not reach ${url}`,
      url,
      undefined,
      message ? { message } : {}
    );
  }

  unknown(url: string, message: string): FetchError {
    return new FetchError(message, url);
  }
}

const fetchErrors = new FetchErrorFactory();

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function resolveErrorUrl(error: unknown, fallback: string): string {
  if (error instanceof FetchError) return error.url;
  if (!isObject(error)) return fallback;

  const { requestUrl } = error as Record<string, unknown>;
  return typeof requestUrl === 'string' ? requestUrl : fallback;
}

function mapFetchError(
  error: unknown,
  fallbackUrl: string,
  timeoutMs: number
): FetchError {
  if (error instanceof FetchError) return error;

  const url = resolveErrorUrl(error, fallbackUrl);

  if (isAbortError(error)) {
    return isTimeoutError(error)
      ? fetchErrors.timeout(url, timeoutMs)
      : fetchErrors.canceled(url);
  }

  if (error instanceof Error) return fetchErrors.network(url, error.message);
  return fetchErrors.unknown(url, 'Unexpected error');
}

/* -------------------------------------------------------------------------------------------------
 * Telemetry (diagnostics channel + logging)
 * ------------------------------------------------------------------------------------------------- */

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

export interface FetchTelemetryContext {
  requestId: string;
  startTime: number;
  url: string;
  method: string;
  contextRequestId?: string;
  operationId?: string;
}

const SLOW_REQUEST_THRESHOLD_MS = 5000;

class FetchTelemetry {
  start(url: string, method: string): FetchTelemetryContext {
    const safeUrl = redactUrl(url);
    const contextRequestId = getRequestId();
    const operationId = getOperationId();

    const ctx: FetchTelemetryContext = {
      requestId: randomUUID(),
      startTime: performance.now(),
      url: safeUrl,
      method: method.toUpperCase(),
      ...(contextRequestId ? { contextRequestId } : {}),
      ...(operationId ? { operationId } : {}),
    };

    this.publish({
      v: 1,
      type: 'start',
      requestId: ctx.requestId,
      method: ctx.method,
      url: ctx.url,
      ...(ctx.contextRequestId
        ? { contextRequestId: ctx.contextRequestId }
        : {}),
      ...(ctx.operationId ? { operationId: ctx.operationId } : {}),
    });

    logDebug('HTTP Request', {
      requestId: ctx.requestId,
      method: ctx.method,
      url: ctx.url,
      ...(ctx.contextRequestId
        ? { contextRequestId: ctx.contextRequestId }
        : {}),
      ...(ctx.operationId ? { operationId: ctx.operationId } : {}),
    });

    return ctx;
  }

  recordResponse(
    context: FetchTelemetryContext,
    response: Response,
    contentSize?: number
  ): void {
    const duration = performance.now() - context.startTime;
    const durationLabel = `${Math.round(duration)}ms`;

    this.publish({
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

    const contentType = response.headers.get('content-type') ?? undefined;
    const contentLengthHeader = response.headers.get('content-length');
    const size =
      contentLengthHeader ??
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
      ...(size ? { size } : {}),
    });

    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
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

  recordError(
    context: FetchTelemetryContext,
    error: unknown,
    status?: number
  ): void {
    const duration = performance.now() - context.startTime;
    const err = error instanceof Error ? error : new Error(String(error));
    const code = isSystemError(err) ? err.code : undefined;

    this.publish({
      v: 1,
      type: 'error',
      requestId: context.requestId,
      url: context.url,
      error: err.message,
      duration,
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(context.contextRequestId
        ? { contextRequestId: context.contextRequestId }
        : {}),
      ...(context.operationId ? { operationId: context.operationId } : {}),
    });

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

  private publish(event: FetchChannelEvent): void {
    if (!fetchChannel.hasSubscribers) return;
    try {
      fetchChannel.publish(event);
    } catch {
      // Best-effort; subscriber failures must not crash request path.
    }
  }
}

const telemetry = new FetchTelemetry();

/** Backwards-compatible exports */
export function startFetchTelemetry(
  url: string,
  method: string
): FetchTelemetryContext {
  return telemetry.start(url, method);
}

export function recordFetchResponse(
  context: FetchTelemetryContext,
  response: Response,
  contentSize?: number
): void {
  telemetry.recordResponse(context, response, contentSize);
}

export function recordFetchError(
  context: FetchTelemetryContext,
  error: unknown,
  status?: number
): void {
  telemetry.recordError(context, error, status);
}

/* -------------------------------------------------------------------------------------------------
 * Redirect handling
 * ------------------------------------------------------------------------------------------------- */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

function cancelResponseBody(response: Response): void {
  const cancelPromise = response.body?.cancel();
  if (cancelPromise)
    cancelPromise.catch(() => {
      /* ignore */
    });
}

class RedirectFollower {
  async fetchWithRedirects(
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
      const { response, nextUrl } = await this.withRedirectErrorContext(
        currentUrl,
        async () =>
          this.performFetchCycle(currentUrl, init, redirectLimit, redirectCount)
      );

      if (!nextUrl) return { response, url: currentUrl };
      currentUrl = nextUrl;
    }

    throw fetchErrors.tooManyRedirects(currentUrl);
  }

  private async performFetchCycle(
    currentUrl: string,
    init: RequestInit,
    redirectLimit: number,
    redirectCount: number
  ): Promise<{ response: Response; nextUrl?: string }> {
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });

    if (!isRedirectStatus(response.status)) return { response };

    this.assertRedirectWithinLimit(
      response,
      currentUrl,
      redirectLimit,
      redirectCount
    );
    const location = this.getRedirectLocation(response, currentUrl);

    cancelResponseBody(response);
    return {
      response,
      nextUrl: this.resolveRedirectTarget(currentUrl, location),
    };
  }

  private assertRedirectWithinLimit(
    response: Response,
    currentUrl: string,
    redirectLimit: number,
    redirectCount: number
  ): void {
    if (redirectCount < redirectLimit) return;
    cancelResponseBody(response);
    throw fetchErrors.tooManyRedirects(currentUrl);
  }

  private getRedirectLocation(response: Response, currentUrl: string): string {
    const location = response.headers.get('location');
    if (location) return location;

    cancelResponseBody(response);
    throw fetchErrors.missingRedirectLocation(currentUrl);
  }

  private resolveRedirectTarget(baseUrl: string, location: string): string {
    if (!URL.canParse(location, baseUrl))
      throw createErrorWithCode('Invalid redirect target', 'EBADREDIRECT');

    const resolved = new URL(location, baseUrl);
    if (resolved.username || resolved.password) {
      throw createErrorWithCode(
        'Redirect target includes credentials',
        'EBADREDIRECT'
      );
    }

    return validateAndNormalizeUrl(resolved.href);
  }

  private annotateRedirectError(error: unknown, url: string): void {
    if (!isObject(error)) return;
    (error as Record<string, unknown>).requestUrl = url;
  }

  private async withRedirectErrorContext<T>(
    url: string,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: unknown) {
      this.annotateRedirectError(error, url);
      throw error;
    }
  }
}

const redirectFollower = new RedirectFollower();

/** Backwards-compatible export */
export async function fetchWithRedirects(
  url: string,
  init: RequestInit,
  maxRedirects: number
): Promise<{ response: Response; url: string }> {
  return redirectFollower.fetchWithRedirects(url, init, maxRedirects);
}

/* -------------------------------------------------------------------------------------------------
 * Response reading (max size + abort-aware streaming)
 * ------------------------------------------------------------------------------------------------- */

function assertContentLengthWithinLimit(
  response: Response,
  url: string,
  maxBytes: number
): void {
  const header = response.headers.get('content-length');
  if (!header) return;

  const contentLength = Number.parseInt(header, 10);
  if (Number.isNaN(contentLength) || contentLength <= maxBytes) return;

  cancelResponseBody(response);
  throw fetchErrors.sizeLimit(url, maxBytes);
}

class ResponseTextReader {
  async read(
    response: Response,
    url: string,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<{ text: string; size: number }> {
    assertContentLengthWithinLimit(response, url, maxBytes);

    if (!response.body) {
      const text = await response.text();
      const size = Buffer.byteLength(text);
      if (size > maxBytes) throw fetchErrors.sizeLimit(url, maxBytes);
      return { text, size };
    }

    return this.readStreamWithLimit(response.body, url, maxBytes, signal);
  }

  private async readStreamWithLimit(
    stream: ReadableStream<Uint8Array>,
    url: string,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<{ text: string; size: number }> {
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let total = 0;

    const reader = stream.getReader();
    try {
      await this.throwIfAborted(signal, url, reader);

      let result = await reader.read();
      while (!result.done) {
        total += result.value.byteLength;
        if (total > maxBytes) throw fetchErrors.sizeLimit(url, maxBytes);

        const decoded = decoder.decode(result.value, { stream: true });
        if (decoded) parts.push(decoded);

        await this.throwIfAborted(signal, url, reader);
        result = await reader.read();
      }
    } catch (error: unknown) {
      await this.cancelReaderQuietly(reader);
      if (signal?.aborted)
        throw new FetchError(
          'Request was aborted during response read',
          url,
          499,
          { reason: 'aborted' }
        );
      throw error;
    } finally {
      reader.releaseLock();
    }

    const final = decoder.decode();
    if (final) parts.push(final);

    return { text: parts.join(''), size: total };
  }

  private async throwIfAborted(
    signal: AbortSignal | undefined,
    url: string,
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<void> {
    if (!signal?.aborted) return;
    await this.cancelReaderQuietly(reader);
    throw new FetchError('Request was aborted during response read', url, 499, {
      reason: 'aborted',
    });
  }

  private async cancelReaderQuietly(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

const responseReader = new ResponseTextReader();

/** Backwards-compatible export */
export async function readResponseText(
  response: Response,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; size: number }> {
  return responseReader.read(response, url, maxBytes, signal);
}

/* -------------------------------------------------------------------------------------------------
 * HTTP fetcher (headers, signals, response handling)
 * ------------------------------------------------------------------------------------------------- */

const DEFAULT_HEADERS = {
  'User-Agent': config.fetcher.userAgent,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
} as const satisfies Record<string, string>;

function buildHeaders(): Record<string, string> {
  return { ...DEFAULT_HEADERS };
}

function buildRequestSignal(
  timeoutMs: number,
  external?: AbortSignal
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;
}

function buildRequestInit(
  headers: HeadersInit,
  signal: AbortSignal
): RequestInit & { dispatcher: Dispatcher } {
  return { method: 'GET', headers, signal, dispatcher };
}

function resolveResponseError(
  response: Response,
  finalUrl: string
): FetchError | null {
  if (response.status === 429) {
    return fetchErrors.rateLimited(
      finalUrl,
      response.headers.get('retry-after')
    );
  }
  return response.ok
    ? null
    : fetchErrors.http(finalUrl, response.status, response.statusText);
}

async function handleFetchResponse(
  response: Response,
  finalUrl: string,
  ctx: FetchTelemetryContext,
  signal?: AbortSignal
): Promise<string> {
  const responseError = resolveResponseError(response, finalUrl);
  if (responseError) {
    cancelResponseBody(response);
    throw responseError;
  }

  const { text, size } = await responseReader.read(
    response,
    finalUrl,
    config.fetcher.maxContentLength,
    signal
  );
  telemetry.recordResponse(ctx, response, size);
  return text;
}

class HttpFetcher {
  async fetchNormalizedUrl(
    normalizedUrl: string,
    options?: FetchOptions
  ): Promise<string> {
    const timeoutMs = config.fetcher.timeout;
    const headers = buildHeaders();
    const signal = buildRequestSignal(timeoutMs, options?.signal);
    const init = buildRequestInit(headers, signal);

    const ctx = telemetry.start(normalizedUrl, 'GET');

    try {
      const { response, url: finalUrl } =
        await redirectFollower.fetchWithRedirects(
          normalizedUrl,
          init,
          config.fetcher.maxRedirects
        );

      ctx.url = finalUrl;
      return await handleFetchResponse(
        response,
        finalUrl,
        ctx,
        init.signal ?? undefined
      );
    } catch (error: unknown) {
      const mapped = mapFetchError(error, normalizedUrl, timeoutMs);
      ctx.url = mapped.url;
      telemetry.recordError(ctx, mapped, mapped.statusCode);
      throw mapped;
    }
  }
}

const httpFetcher = new HttpFetcher();

/** Backwards-compatible export */
export async function fetchNormalizedUrl(
  normalizedUrl: string,
  options?: FetchOptions
): Promise<string> {
  return httpFetcher.fetchNormalizedUrl(normalizedUrl, options);
}
