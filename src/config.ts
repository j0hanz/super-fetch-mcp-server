import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url)
);
const packageJson = require(packageJsonPath) as { version?: string };
if (typeof packageJson.version !== 'string') {
  throw new Error('package.json version is missing');
}

export const serverVersion: string = packageJson.version;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Hardcoded to 'markdown'. Type retained for consumer compatibility. */
export type TransformMetadataFormat = 'markdown';

type AuthMode = 'oauth' | 'static';

const { env } = process;

class ConfigError extends Error {
  override name = 'ConfigError';
}

function buildIpv4(parts: readonly [number, number, number, number]): string {
  return parts.join('.');
}

function formatHostForUrl(hostname: string): string {
  if (hostname.includes(':') && !hostname.startsWith('['))
    return `[${hostname}]`;
  return hostname;
}

function normalizeHostValue(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (raw.includes('://') && URL.canParse(raw)) {
    return new URL(raw).hostname.toLowerCase();
  }

  const lowered = raw.toLowerCase();

  if (lowered.startsWith('[')) {
    const end = lowered.indexOf(']');
    if (end === -1) return null;
    return lowered.slice(1, end);
  }

  const firstColon = lowered.indexOf(':');
  if (firstColon === -1) return lowered;
  if (lowered.includes(':', firstColon + 1)) return lowered;

  const host = lowered.slice(0, firstColon);
  return host || null;
}

function parseIntegerValue(
  envValue: string | undefined,
  min?: number,
  max?: number
): number | null {
  if (!envValue) return null;
  const parsed = Number.parseInt(envValue, 10);
  if (Number.isNaN(parsed)) return null;
  if (min !== undefined && parsed < min) return null;
  if (max !== undefined && parsed > max) return null;
  return parsed;
}

function parseInteger(
  envValue: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  return parseIntegerValue(envValue, min, max) ?? defaultValue;
}

function parseBoolean(
  envValue: string | undefined,
  defaultValue: boolean
): boolean {
  if (!envValue) return defaultValue;

  return envValue.trim().toLowerCase() !== 'false';
}

function parseList(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseUrlEnv(value: string | undefined, name: string): URL | undefined {
  if (!value) return undefined;
  if (!URL.canParse(value)) {
    throw new ConfigError(`Invalid ${name} value: ${value}`);
  }
  return new URL(value);
}

function readUrlEnv(name: string): URL | undefined {
  return parseUrlEnv(env[name], name);
}

function parseAllowedHosts(envValue: string | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const entry of parseList(envValue)) {
    const normalized = normalizeHostValue(entry);
    if (normalized) hosts.add(normalized);
  }
  return hosts;
}

const ALLOWED_LOG_LEVELS: ReadonlySet<string> = new Set(LOG_LEVELS);

function isLogLevel(value: string): value is LogLevel {
  return ALLOWED_LOG_LEVELS.has(value);
}

function parseLogLevel(envValue: string | undefined): LogLevel {
  if (!envValue) return 'info';
  const level = envValue.toLowerCase();
  return isLogLevel(level) ? level : 'info';
}

function parsePort(envValue: string | undefined): number {
  if (envValue?.trim() === '0') return 0;
  return parseInteger(envValue, 3000, 1024, 65535);
}

const MAX_HTML_BYTES = 0;
const MAX_INLINE_CONTENT_CHARS = 0;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SESSION_INIT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_USER_AGENT = `superFetch-MCP/${serverVersion}`;
const DEFAULT_TOOL_TIMEOUT_PADDING_MS = 5000;
const DEFAULT_TRANSFORM_TIMEOUT_MS = 30000;

const DEFAULT_FETCH_TIMEOUT_MS = parseInteger(
  env.FETCH_TIMEOUT_MS,
  15000,
  1000,
  60000
);
const DEFAULT_TOOL_TIMEOUT_MS =
  DEFAULT_FETCH_TIMEOUT_MS +
  DEFAULT_TRANSFORM_TIMEOUT_MS +
  DEFAULT_TOOL_TIMEOUT_PADDING_MS;

interface AuthConfig {
  mode: AuthMode;
  issuerUrl: URL | undefined;
  authorizationUrl: URL | undefined;
  tokenUrl: URL | undefined;
  revocationUrl: URL | undefined;
  registrationUrl: URL | undefined;
  introspectionUrl: URL | undefined;
  resourceUrl: URL;
  requiredScopes: string[];
  clientId: string | undefined;
  clientSecret: string | undefined;
  introspectionTimeoutMs: number;
  staticTokens: string[];
}

interface OAuthUrls {
  issuerUrl: URL | undefined;
  authorizationUrl: URL | undefined;
  tokenUrl: URL | undefined;
  revocationUrl: URL | undefined;
  registrationUrl: URL | undefined;
  introspectionUrl: URL | undefined;
  resourceUrl: URL;
}

type OAuthModeInputs = Pick<
  OAuthUrls,
  'issuerUrl' | 'authorizationUrl' | 'tokenUrl' | 'introspectionUrl'
>;

function readOAuthUrls(baseUrl: URL): OAuthUrls {
  const issuerUrl = readUrlEnv('OAUTH_ISSUER_URL');
  const authorizationUrl = readUrlEnv('OAUTH_AUTHORIZATION_URL');
  const tokenUrl = readUrlEnv('OAUTH_TOKEN_URL');
  const revocationUrl = readUrlEnv('OAUTH_REVOCATION_URL');
  const registrationUrl = readUrlEnv('OAUTH_REGISTRATION_URL');
  const introspectionUrl = readUrlEnv('OAUTH_INTROSPECTION_URL');
  const resourceUrl = new URL('/mcp', baseUrl);

  return {
    issuerUrl,
    authorizationUrl,
    tokenUrl,
    revocationUrl,
    registrationUrl,
    introspectionUrl,
    resourceUrl,
  };
}

function resolveAuthMode(urls: OAuthModeInputs): AuthMode {
  const oauthConfigured = [
    urls.issuerUrl,
    urls.authorizationUrl,
    urls.tokenUrl,
    urls.introspectionUrl,
  ].some((value) => value !== undefined);

  return oauthConfigured ? 'oauth' : 'static';
}

function collectStaticTokens(): string[] {
  const staticTokens = new Set<string>(parseList(env.ACCESS_TOKENS));
  if (env.API_KEY) staticTokens.add(env.API_KEY);
  return [...staticTokens];
}

function buildAuthConfig(baseUrl: URL): AuthConfig {
  const urls = readOAuthUrls(baseUrl);
  const mode = resolveAuthMode(urls);

  return {
    mode,
    ...urls,
    requiredScopes: parseList(env.OAUTH_REQUIRED_SCOPES),
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    introspectionTimeoutMs: 5000,
    staticTokens: collectStaticTokens(),
  };
}

const LOOPBACK_V4 = buildIpv4([127, 0, 0, 1]);
const ANY_V4 = buildIpv4([0, 0, 0, 0]);
const METADATA_V4_AWS = buildIpv4([169, 254, 169, 254]);
const METADATA_V4_AZURE = buildIpv4([100, 100, 100, 200]);

const BLOCKED_HOSTS = new Set<string>([
  'localhost',
  LOOPBACK_V4,
  ANY_V4,
  '::1',
  METADATA_V4_AWS,
  'metadata.google.internal',
  'metadata.azure.com',
  METADATA_V4_AZURE,
  'instance-data',
]);

const BLOCKED_IP_PATTERNS: readonly RegExp[] = [
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
];

const BLOCKED_IP_PATTERN =
  /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.|100\.64\.|fc00:|fd00:|fe80:)/i;
const BLOCKED_IPV4_MAPPED_PATTERN =
  /^::ffff:(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i;

const host = (env.HOST ?? LOOPBACK_V4).trim();
const port = parsePort(env.PORT);

const baseUrl = new URL(`http://${formatHostForUrl(host)}:${port}`);

const allowRemote = parseBoolean(env.ALLOW_REMOTE, false);

interface RuntimeState {
  httpMode: boolean;
}

const runtimeState: RuntimeState = {
  httpMode: false,
};

export const config = {
  server: {
    name: 'superFetch',
    version: serverVersion,
    port,
    host,
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    sessionInitTimeoutMs: DEFAULT_SESSION_INIT_TIMEOUT_MS,
    maxSessions: DEFAULT_MAX_SESSIONS,
    http: {
      headersTimeoutMs: undefined,
      requestTimeoutMs: undefined,
      keepAliveTimeoutMs: undefined,
      shutdownCloseIdleConnections: true,
      shutdownCloseAllConnections: false,
    },
  },
  fetcher: {
    timeout: DEFAULT_FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    userAgent: env.USER_AGENT ?? DEFAULT_USER_AGENT,
    maxContentLength: MAX_HTML_BYTES,
  },
  transform: {
    timeoutMs: DEFAULT_TRANSFORM_TIMEOUT_MS,
    stageWarnRatio: 0.5,
    metadataFormat: 'markdown',
    maxWorkerScale: 4,
  },
  tools: {
    enabled: ['fetch-url'],
    timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  },
  cache: {
    enabled: parseBoolean(env.CACHE_ENABLED, true),
    ttl: 86400,
    maxKeys: 100,
  },
  extraction: {
    maxBlockLength: 5000,
    minParagraphLength: 10,
  },
  noiseRemoval: {
    extraTokens: parseList(env.SUPERFETCH_EXTRA_NOISE_TOKENS),
    extraSelectors: parseList(env.SUPERFETCH_EXTRA_NOISE_SELECTORS),
    enabledCategories: [
      'cookie-banners',
      'newsletters',
      'social-share',
      'nav-footer',
    ],
    debug: false,
    aggressiveMode: false,
    preserveSvgCanvas: false,
    weights: {
      hidden: 50,
      structural: 50,
      promo: 35,
      stickyFixed: 30,
      threshold: 50,
    },
  },
  markdownCleanup: {
    promoteOrphanHeadings: true,
    removeSkipLinks: true,
    removeTocBlocks: true,
    removeTypeDocComments: true,
  },
  logging: {
    level: parseLogLevel(env.LOG_LEVEL),
  },
  constants: {
    maxHtmlSize: MAX_HTML_BYTES,
    maxUrlLength: 2048,
    maxInlineContentChars: MAX_INLINE_CONTENT_CHARS,
  },
  security: {
    blockedHosts: BLOCKED_HOSTS,
    blockedIpPatterns: BLOCKED_IP_PATTERNS,
    blockedIpPattern: BLOCKED_IP_PATTERN,
    blockedIpv4MappedPattern: BLOCKED_IPV4_MAPPED_PATTERN,
    allowedHosts: parseAllowedHosts(env.ALLOWED_HOSTS),
    apiKey: env.API_KEY,
    allowRemote,
  },
  auth: buildAuthConfig(baseUrl),
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
