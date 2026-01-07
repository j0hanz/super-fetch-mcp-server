import packageJson from '../../package.json' with { type: 'json' };
import { SIZE_LIMITS, TIMEOUT } from './constants.js';
import type { LogLevel } from './types/runtime.js';

function parseInteger(
  envValue: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  if (!envValue) return defaultValue;
  const parsed = parseInt(envValue, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  if (min !== undefined && parsed < min) return defaultValue;
  if (max !== undefined && parsed > max) return defaultValue;
  return parsed;
}

function parseBoolean(
  envValue: string | undefined,
  defaultValue: boolean
): boolean {
  if (!envValue) return defaultValue;
  return envValue !== 'false';
}

function parseList(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseScopes(envValue: string | undefined): string[] {
  return parseList(envValue);
}

function formatHostForUrl(hostname: string): string {
  if (hostname.includes(':') && !hostname.startsWith('[')) {
    return `[${hostname}]`;
  }
  return hostname;
}

function parseUrlEnv(value: string | undefined, name: string): URL | undefined {
  if (!value) return undefined;
  if (!URL.canParse(value)) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return new URL(value);
}

function normalizeHostValue(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) return null;
    return trimmed.slice(1, end);
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex !== -1) {
    return trimmed.slice(0, colonIndex);
  }

  return trimmed;
}

function parseAllowedHosts(envValue: string | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const entry of parseList(envValue)) {
    const normalized = normalizeHostValue(entry);
    if (normalized) {
      hosts.add(normalized);
    }
  }
  return hosts;
}

function parseLogLevel(envValue: string | undefined): LogLevel {
  const level = envValue?.toLowerCase();
  if (!level) return 'info';
  return isLogLevel(level) ? level : 'info';
}

const ALLOWED_LOG_LEVELS: ReadonlySet<string> = new Set([
  'debug',
  'info',
  'warn',
  'error',
]);

function isLogLevel(value: string): value is LogLevel {
  return ALLOWED_LOG_LEVELS.has(value);
}

const host = process.env.HOST ?? '127.0.0.1';
const port = parseInteger(process.env.PORT, 3000, 1024, 65535);
const baseUrl = new URL(`http://${formatHostForUrl(host)}:${port}`);

const isRemoteHost = host === '0.0.0.0' || host === '::';

interface RuntimeState {
  httpMode: boolean;
}

const runtimeState: RuntimeState = {
  httpMode: false,
};

export const config = {
  server: {
    name: 'superFetch',
    version: packageJson.version,
    port,
    host,
    sessionTtlMs: TIMEOUT.DEFAULT_SESSION_TTL_MS,
    sessionInitTimeoutMs: 10000,
    maxSessions: 200,
  },
  fetcher: {
    timeout: TIMEOUT.DEFAULT_FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    userAgent: process.env.USER_AGENT ?? 'superFetch-MCP/2.0',
    maxContentLength: SIZE_LIMITS.TEN_MB,
  },
  cache: {
    enabled: parseBoolean(process.env.CACHE_ENABLED, true),
    ttl: parseInteger(process.env.CACHE_TTL, 3600, 60, 86400),
    maxKeys: 100,
  },
  extraction: {
    maxBlockLength: 5000,
    minParagraphLength: 10,
  },
  logging: {
    level: parseLogLevel(process.env.LOG_LEVEL),
  },
  constants: {
    maxHtmlSize: SIZE_LIMITS.TEN_MB,
    maxUrlLength: 2048,
    maxInlineContentChars: 20000,
  },
  security: {
    blockedHosts: new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254.169.254',
      'metadata.google.internal',
      'metadata.azure.com',
      '100.100.100.200',
      'instance-data',
    ]),
    blockedIpPatterns: [
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^127\./,
      /^0\./,
      /^169\.254\./,
      /^100\.64\./,
      /^fc00:/i,
      /^fd00:/i,
      /^fe80:/i,
      /^::ffff:127\./,
      /^::ffff:10\./,
      /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
      /^::ffff:192\.168\./,
      /^::ffff:169\.254\./,
    ],
    allowedHosts: parseAllowedHosts(process.env.ALLOWED_HOSTS),
    apiKey: process.env.API_KEY,
    allowRemote: isRemoteHost,
  },
  auth: (() => {
    const issuerUrl = parseUrlEnv(
      process.env.OAUTH_ISSUER_URL,
      'OAUTH_ISSUER_URL'
    );
    const authorizationUrl = parseUrlEnv(
      process.env.OAUTH_AUTHORIZATION_URL,
      'OAUTH_AUTHORIZATION_URL'
    );
    const tokenUrl = parseUrlEnv(
      process.env.OAUTH_TOKEN_URL,
      'OAUTH_TOKEN_URL'
    );
    const revocationUrl = parseUrlEnv(
      process.env.OAUTH_REVOCATION_URL,
      'OAUTH_REVOCATION_URL'
    );
    const registrationUrl = parseUrlEnv(
      process.env.OAUTH_REGISTRATION_URL,
      'OAUTH_REGISTRATION_URL'
    );
    const introspectionUrl = parseUrlEnv(
      process.env.OAUTH_INTROSPECTION_URL,
      'OAUTH_INTROSPECTION_URL'
    );
    const resourceUrl =
      parseUrlEnv(process.env.OAUTH_RESOURCE_URL, 'OAUTH_RESOURCE_URL') ??
      new URL('/mcp', baseUrl);

    const authModeEnv = process.env.AUTH_MODE?.toLowerCase();
    const oauthConfigured = [
      issuerUrl,
      authorizationUrl,
      tokenUrl,
      introspectionUrl,
    ].some((value) => value !== undefined);
    const mode =
      authModeEnv === 'oauth'
        ? 'oauth'
        : authModeEnv === 'static'
          ? 'static'
          : oauthConfigured
            ? 'oauth'
            : 'static';

    const requiredScopes = parseScopes(process.env.OAUTH_REQUIRED_SCOPES);
    const staticTokens = new Set<string>(parseList(process.env.ACCESS_TOKENS));
    if (process.env.API_KEY) {
      staticTokens.add(process.env.API_KEY);
    }

    return {
      mode,
      issuerUrl,
      authorizationUrl,
      tokenUrl,
      revocationUrl,
      registrationUrl,
      introspectionUrl,
      resourceUrl,
      requiredScopes,
      clientId: process.env.OAUTH_CLIENT_ID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      introspectionTimeoutMs: parseInteger(
        process.env.OAUTH_INTROSPECTION_TIMEOUT_MS,
        5000,
        1000,
        30000
      ),
      staticTokens: Array.from(staticTokens),
    };
  })(),
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60000,
    cleanupIntervalMs: 60000,
  },
  runtime: runtimeState,
};

export function enableHttpMode(): void {
  runtimeState.httpMode = true;
}
