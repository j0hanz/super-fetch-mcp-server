import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { config } from '../config/index.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getNonEmptyStringHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function respondHostNotAllowed(res: Response): void {
  res.status(403).json({
    error: 'Host not allowed',
    code: 'HOST_NOT_ALLOWED',
  });
}

function respondOriginNotAllowed(res: Response): void {
  res.status(403).json({
    error: 'Origin not allowed',
    code: 'ORIGIN_NOT_ALLOWED',
  });
}

function tryParseOriginHostname(originHeader: string): string | null {
  try {
    return new URL(originHeader).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function takeFirstHostValue(value: string): string | null {
  const first = value.split(',')[0];
  if (!first) return null;
  const trimmed = first.trim();
  return trimmed ? trimmed : null;
}

function stripIpv6Brackets(value: string): string | null {
  if (!value.startsWith('[')) return null;
  const end = value.indexOf(']');
  if (end === -1) return null;
  return value.slice(1, end);
}

function stripPortIfPresent(value: string): string {
  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) return value;
  return value.slice(0, colonIndex);
}

function normalizeHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const first = takeFirstHostValue(trimmed);
  if (!first) return null;

  const ipv6 = stripIpv6Brackets(first);
  if (ipv6) return ipv6;

  return stripPortIfPresent(first);
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

function addLoopbackHosts(allowedHosts: Set<string>): void {
  for (const host of LOOPBACK_HOSTS) {
    allowedHosts.add(host);
  }
}

function addConfiguredHost(allowedHosts: Set<string>): void {
  const configuredHost = normalizeHost(config.server.host);
  if (!configuredHost) return;
  if (isWildcardHost(configuredHost)) return;
  allowedHosts.add(configuredHost);
}

function addExplicitAllowedHosts(allowedHosts: Set<string>): void {
  for (const host of config.security.allowedHosts) {
    allowedHosts.add(host);
  }
}

function buildAllowedHosts(): Set<string> {
  const allowedHosts = new Set<string>();

  addLoopbackHosts(allowedHosts);
  addConfiguredHost(allowedHosts);
  addExplicitAllowedHosts(allowedHosts);

  return allowedHosts;
}

export function createHostValidationMiddleware(): RequestHandler {
  const allowedHosts = buildAllowedHosts();

  return (req: Request, res: Response, next: NextFunction): void => {
    const hostHeader =
      typeof req.headers.host === 'string' ? req.headers.host : '';

    const normalized = normalizeHost(hostHeader);

    if (!normalized || !allowedHosts.has(normalized)) {
      respondHostNotAllowed(res);
      return;
    }

    next();
  };
}

export function createOriginValidationMiddleware(): RequestHandler {
  const allowedHosts = buildAllowedHosts();

  return (req: Request, res: Response, next: NextFunction): void => {
    const originHeader = getNonEmptyStringHeader(req.headers.origin);
    if (!originHeader) {
      next();
      return;
    }

    const originHostname = tryParseOriginHostname(originHeader);
    if (!originHostname || !allowedHosts.has(originHostname)) {
      respondOriginNotAllowed(res);
      return;
    }

    next();
  };
}
