import type { Request } from 'express';

function getAcceptHeader(req: Request): string {
  const value = req.headers.accept;
  if (typeof value === 'string') return value;
  return '';
}

function setAcceptHeader(req: Request, value: string): void {
  req.headers.accept = value;

  const { rawHeaders } = req;
  if (!Array.isArray(rawHeaders)) return;

  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const key = rawHeaders[i];
    if (typeof key === 'string' && key.toLowerCase() === 'accept') {
      rawHeaders[i + 1] = value;
      return;
    }
  }

  rawHeaders.push('Accept', value);
}

function hasToken(header: string, token: string): boolean {
  return header
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === token || part.startsWith(`${token};`));
}

export function ensurePostAcceptHeader(req: Request): void {
  const accept = getAcceptHeader(req);

  // Some clients send */* or omit Accept; the SDK transport is picky.
  if (!accept || hasToken(accept, '*/*')) {
    setAcceptHeader(req, 'application/json, text/event-stream');
    return;
  }

  const hasJson = hasToken(accept, 'application/json');
  const hasSse = hasToken(accept, 'text/event-stream');

  if (!hasJson || !hasSse) {
    setAcceptHeader(req, 'application/json, text/event-stream');
  }
}

export function acceptsEventStream(req: Request): boolean {
  const accept = getAcceptHeader(req);
  if (!accept) return false;
  return hasToken(accept, 'text/event-stream');
}
