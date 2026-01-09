import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from 'express';

import {
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { config } from '../config/index.js';

import { timingSafeEqualUtf8 } from '../utils/crypto.js';
import { isRecord } from '../utils/guards.js';

const STATIC_TOKEN_TTL_SECONDS = 60 * 60 * 24;

function stripHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

function parseScopes(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(' ')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }

  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === 'string');
  }

  return [];
}

function parseResourceUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  if (!URL.canParse(value)) return undefined;
  return new URL(value);
}

function parseAudResource(aud: unknown): URL | undefined {
  if (typeof aud === 'string') {
    return parseResourceUrl(aud);
  }

  if (Array.isArray(aud)) {
    for (const entry of aud) {
      const parsed = parseResourceUrl(entry);
      if (parsed) return parsed;
    }
  }

  return undefined;
}

function extractResource(data: Record<string, unknown>): URL | undefined {
  const resource = parseResourceUrl(data.resource);
  if (resource) return resource;

  return parseAudResource(data.aud);
}

function extractScopes(data: Record<string, unknown>): string[] {
  if (data.scope !== undefined) {
    return parseScopes(data.scope);
  }

  if (data.scopes !== undefined) {
    return parseScopes(data.scopes);
  }

  if (data.scp !== undefined) {
    return parseScopes(data.scp);
  }

  return [];
}

function readExpiresAt(data: Record<string, unknown>): number {
  const expiresAt = typeof data.exp === 'number' ? data.exp : Number.NaN;
  if (!Number.isFinite(expiresAt)) {
    throw new InvalidTokenError('Token has no expiration time');
  }
  return expiresAt;
}

function resolveClientId(data: Record<string, unknown>): string {
  if (typeof data.client_id === 'string') return data.client_id;
  if (typeof data.cid === 'string') return data.cid;
  if (typeof data.sub === 'string') return data.sub;
  return 'unknown';
}

function ensureResourceMatch(resource: URL | undefined): URL | undefined {
  if (resource && stripHash(resource) !== stripHash(config.auth.resourceUrl)) {
    throw new InvalidTokenError('Token resource mismatch');
  }
  return resource;
}

function buildIntrospectionAuthInfo(
  token: string,
  data: Record<string, unknown>
): AuthInfo {
  const resource = ensureResourceMatch(extractResource(data));

  return {
    token,
    clientId: resolveClientId(data),
    scopes: extractScopes(data),
    expiresAt: readExpiresAt(data),
    resource: resource ?? config.auth.resourceUrl,
    extra: data,
  };
}

interface IntrospectionRequest {
  body: string;
  headers: Record<string, string>;
}

function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string | undefined
): string {
  const secret = clientSecret ?? '';
  const basic = Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64');
  return `Basic ${basic}`;
}

function buildIntrospectionRequest(
  token: string,
  resourceUrl: URL,
  clientId: string | undefined,
  clientSecret: string | undefined
): IntrospectionRequest {
  const body = new URLSearchParams({
    token,
    token_type_hint: 'access_token',
    resource: stripHash(resourceUrl),
  }).toString();
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (clientId) {
    headers.authorization = buildBasicAuthHeader(clientId, clientSecret);
  }

  return { body, headers };
}

async function requestIntrospection(
  introspectionUrl: URL,
  request: IntrospectionRequest,
  timeoutMs: number
): Promise<unknown> {
  const response = await fetch(introspectionUrl, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new ServerError(`Token introspection failed: ${response.status}`);
  }

  return response.json();
}

function parseIntrospectionPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || Array.isArray(payload)) {
    throw new ServerError('Invalid introspection response');
  }
  if (payload.active !== true) {
    throw new InvalidTokenError('Token is inactive');
  }
  return payload;
}

async function verifyWithIntrospection(token: string): Promise<AuthInfo> {
  const { auth } = config;
  if (!auth.introspectionUrl) {
    throw new ServerError('Token introspection is not configured');
  }
  const request = buildIntrospectionRequest(
    token,
    auth.resourceUrl,
    auth.clientId,
    auth.clientSecret
  );
  const payload = await requestIntrospection(
    auth.introspectionUrl,
    request,
    auth.introspectionTimeoutMs
  );
  return buildIntrospectionAuthInfo(token, parseIntrospectionPayload(payload));
}

function buildStaticAuthInfo(token: string): AuthInfo {
  return {
    token,
    clientId: 'static-token',
    scopes: config.auth.requiredScopes,
    expiresAt: Math.floor(Date.now() / 1000) + STATIC_TOKEN_TTL_SECONDS,
    resource: config.auth.resourceUrl,
  };
}

function verifyStaticToken(token: string): AuthInfo {
  if (config.auth.staticTokens.length === 0) {
    throw new InvalidTokenError('No static tokens configured');
  }

  const matched = config.auth.staticTokens.some((candidate) =>
    timingSafeEqualUtf8(candidate, token)
  );
  if (!matched) {
    throw new InvalidTokenError('Invalid token');
  }

  return buildStaticAuthInfo(token);
}

function normalizeHeaderValue(
  header: string | string[] | undefined
): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function getApiKeyHeader(req: Request): string | null {
  const apiKeyHeader = normalizeHeaderValue(req.headers['x-api-key']);
  return apiKeyHeader ? apiKeyHeader.trim() : null;
}

function createLegacyApiKeyMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (config.auth.mode !== 'static') {
      next();
      return;
    }

    if (!req.headers.authorization) {
      const apiKey = getApiKeyHeader(req);
      if (apiKey) {
        req.headers.authorization = `Bearer ${apiKey}`;
      }
    }

    next();
  };
}

async function verifyAccessToken(token: string): Promise<AuthInfo> {
  if (config.auth.mode === 'oauth') {
    return verifyWithIntrospection(token);
  }

  return verifyStaticToken(token);
}

function resolveMetadataUrl(): string | null {
  if (config.auth.mode !== 'oauth') return null;
  return getOAuthProtectedResourceMetadataUrl(new URL(config.auth.resourceUrl));
}

function resolveOptionalScopes(
  requiredScopes: readonly string[]
): string[] | undefined {
  return requiredScopes.length > 0 ? [...requiredScopes] : undefined;
}

type OAuthAuthConfig = typeof config.auth;

function resolveOAuthMetadataParams(
  authConfig: OAuthAuthConfig
): OAuthMetadataParams | null {
  const {
    issuerUrl,
    authorizationUrl,
    tokenUrl,
    revocationUrl,
    registrationUrl,
    requiredScopes,
  } = authConfig;

  if (!issuerUrl || !authorizationUrl || !tokenUrl) return null;

  return {
    issuerUrl,
    authorizationUrl,
    tokenUrl,
    revocationUrl,
    registrationUrl,
    requiredScopes,
  };
}

interface OAuthMetadata extends Record<string, unknown> {
  issuer: string;
  authorization_endpoint: string;
  response_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint: string;
  token_endpoint_auth_methods_supported: string[];
  grant_types_supported: string[];
  scopes_supported?: string[];
  revocation_endpoint?: string;
  registration_endpoint?: string;
}

interface OAuthMetadataParams {
  issuerUrl: URL;
  authorizationUrl: URL;
  tokenUrl: URL;
  revocationUrl: URL | undefined;
  registrationUrl: URL | undefined;
  requiredScopes: readonly string[];
}

type OptionalEndpointKey = 'revocation_endpoint' | 'registration_endpoint';

function buildBaseOAuthMetadata(params: OAuthMetadataParams): OAuthMetadata {
  return {
    issuer: params.issuerUrl.href,
    authorization_endpoint: params.authorizationUrl.href,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint: params.tokenUrl.href,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  };
}

function applyOptionalScopes(
  metadata: OAuthMetadata,
  requiredScopes: readonly string[]
): void {
  const scopesSupported = resolveOptionalScopes(requiredScopes);
  if (scopesSupported !== undefined) {
    metadata.scopes_supported = scopesSupported;
  }
}

function applyOptionalEndpoint(
  metadata: OAuthMetadata,
  key: OptionalEndpointKey,
  url: URL | undefined
): void {
  if (!url) return;
  metadata[key] = url.href;
}

function buildOAuthMetadata(params: OAuthMetadataParams): OAuthMetadata {
  const oauthMetadata = buildBaseOAuthMetadata(params);
  applyOptionalScopes(oauthMetadata, params.requiredScopes);
  applyOptionalEndpoint(
    oauthMetadata,
    'revocation_endpoint',
    params.revocationUrl
  );
  applyOptionalEndpoint(
    oauthMetadata,
    'registration_endpoint',
    params.registrationUrl
  );
  return oauthMetadata;
}

export function createAuthMiddleware(): RequestHandler {
  const metadataUrl = resolveMetadataUrl();
  const authHandler = requireBearerAuth({
    verifier: { verifyAccessToken },
    requiredScopes: config.auth.requiredScopes,
    ...(metadataUrl ? { resourceMetadataUrl: metadataUrl } : {}),
  });
  const legacyHandler = createLegacyApiKeyMiddleware();

  return (req: Request, res: Response, next: NextFunction): void => {
    legacyHandler(req, res, () => {
      authHandler(req, res, next);
    });
  };
}

export function createAuthMetadataRouter(): Router | null {
  if (config.auth.mode !== 'oauth') return null;

  const oauthMetadataParams = resolveOAuthMetadataParams(config.auth);
  if (!oauthMetadataParams) return null;

  return mcpAuthMetadataRouter({
    oauthMetadata: buildOAuthMetadata(oauthMetadataParams),
    resourceServerUrl: config.auth.resourceUrl,
    scopesSupported: config.auth.requiredScopes,
    resourceName: config.server.name,
  });
}
