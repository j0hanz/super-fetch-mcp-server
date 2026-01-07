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

const STATIC_TOKEN_TTL_SECONDS = 60 * 60 * 24;

function normalizeHeaderValue(
  header: string | string[] | undefined
): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function timingSafeEquals(a: string, b: string): boolean {
  return timingSafeEqualUtf8(a, b);
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
    timingSafeEquals(candidate, token)
  );
  if (!matched) {
    throw new InvalidTokenError('Invalid token');
  }

  return buildStaticAuthInfo(token);
}

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

function extractResource(data: Record<string, unknown>): URL | undefined {
  const resource = parseResourceUrl(data.resource);
  if (resource) return resource;

  const { aud } = data;
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

function buildIntrospectionAuthInfo(
  token: string,
  data: Record<string, unknown>
): AuthInfo {
  const expiresAt = typeof data.exp === 'number' ? data.exp : undefined;
  if (typeof expiresAt !== 'number' || Number.isNaN(expiresAt)) {
    throw new InvalidTokenError('Token has no expiration time');
  }

  const clientId =
    typeof data.client_id === 'string'
      ? data.client_id
      : typeof data.cid === 'string'
        ? data.cid
        : typeof data.sub === 'string'
          ? data.sub
          : 'unknown';

  const resource = extractResource(data);
  if (resource && stripHash(resource) !== stripHash(config.auth.resourceUrl)) {
    throw new InvalidTokenError('Token resource mismatch');
  }

  return {
    token,
    clientId,
    scopes: extractScopes(data),
    expiresAt,
    resource: resource ?? config.auth.resourceUrl,
    extra: data,
  };
}

async function verifyWithIntrospection(token: string): Promise<AuthInfo> {
  const {
    introspectionUrl,
    clientId,
    clientSecret,
    introspectionTimeoutMs,
    resourceUrl,
  } = config.auth;
  if (!introspectionUrl) {
    throw new ServerError('Token introspection is not configured');
  }

  const body = new URLSearchParams();
  body.set('token', token);
  body.set('token_type_hint', 'access_token');
  body.set('resource', stripHash(resourceUrl));

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };

  if (clientId) {
    const secret = clientSecret ?? '';
    const basic = Buffer.from(`${clientId}:${secret}`, 'utf8').toString(
      'base64'
    );
    headers.authorization = `Basic ${basic}`;
  }

  const response = await fetch(introspectionUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(introspectionTimeoutMs),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new ServerError(`Token introspection failed: ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new ServerError('Invalid introspection response');
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.active !== true) {
    throw new InvalidTokenError('Token is inactive');
  }

  return buildIntrospectionAuthInfo(token, payloadRecord);
}

async function verifyAccessToken(token: string): Promise<AuthInfo> {
  if (config.auth.mode === 'oauth') {
    return verifyWithIntrospection(token);
  }

  return verifyStaticToken(token);
}

export function createAuthMiddleware(): RequestHandler {
  const metadataUrl =
    config.auth.mode === 'oauth'
      ? getOAuthProtectedResourceMetadataUrl(config.auth.resourceUrl)
      : null;
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

  const {
    issuerUrl,
    authorizationUrl,
    tokenUrl,
    revocationUrl,
    registrationUrl,
    requiredScopes,
    resourceUrl,
  } = config.auth;

  if (!issuerUrl || !authorizationUrl || !tokenUrl) {
    return null;
  }

  const oauthMetadata = {
    issuer: issuerUrl.href,
    authorization_endpoint: authorizationUrl.href,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint: tokenUrl.href,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: requiredScopes.length > 0 ? requiredScopes : undefined,
    revocation_endpoint: revocationUrl?.href,
    registration_endpoint: registrationUrl?.href,
  };

  return mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: resourceUrl,
    scopesSupported: requiredScopes,
    resourceName: config.server.name,
  });
}
