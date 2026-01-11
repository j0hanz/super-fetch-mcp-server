import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { McpRequestBody } from '../config/types/runtime.js';

import { logError, logInfo } from '../services/logger.js';

import {
  getSessionId,
  type McpSessionOptions,
  resolveTransportForPost,
  sendJsonRpcError,
} from './mcp-sessions.js';

const paramsSchema = z.looseObject({});

const mcpRequestSchema = z.looseObject({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  id: z.union([z.string(), z.number()]).optional(),
  params: paramsSchema.optional(),
});

type RequestWithUnknownBody = Omit<Request, 'body'> & { body: unknown };

function wrapAsync(
  fn: (req: Request, res: Response) => void | Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function isJsonRpcBatchRequest(body: unknown): boolean {
  return Array.isArray(body);
}

export function isMcpRequestBody(body: unknown): body is McpRequestBody {
  return mcpRequestSchema.safeParse(body).success;
}

function respondInvalidRequestBody(res: Response): void {
  sendJsonRpcError(res, -32600, 'Invalid Request: Malformed request body', 400);
}

function respondMissingSession(res: Response): void {
  sendJsonRpcError(res, -32600, 'Missing mcp-session-id header', 400);
}

function respondSessionNotFound(res: Response): void {
  sendJsonRpcError(res, -32600, 'Session not found', 404);
}

function validatePostPayload(
  payload: unknown,
  res: Response
): McpRequestBody | null {
  if (isJsonRpcBatchRequest(payload)) {
    sendJsonRpcError(res, -32600, 'Batch requests are not supported', 400);
    return null;
  }

  if (!isMcpRequestBody(payload)) {
    respondInvalidRequestBody(res);
    return null;
  }

  return payload;
}

function logPostRequest(
  body: McpRequestBody,
  sessionId: string | undefined,
  options: McpSessionOptions
): void {
  logInfo('[MCP POST]', {
    method: body.method,
    id: body.id,
    isInitialize: body.method === 'initialize',
    sessionCount: options.sessionStore.size(),
  });
}

async function handleTransportRequest(
  transport: StreamableHTTPServerTransport,
  req: Request,
  res: Response,
  body?: McpRequestBody
): Promise<void> {
  try {
    await dispatchTransportRequest(transport, req, res, body);
  } catch (error) {
    logError(
      'MCP request handling failed',
      error instanceof Error ? error : undefined
    );
    handleTransportError(res);
  }
}

function handleTransportError(res: Response): void {
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal Server Error' });
}

function dispatchTransportRequest(
  transport: StreamableHTTPServerTransport,
  req: Request,
  res: Response,
  body?: McpRequestBody
): Promise<void> {
  return body
    ? transport.handleRequest(req, res, body)
    : transport.handleRequest(req, res);
}

function resolveSessionTransport(
  sessionId: string | undefined,
  options: McpSessionOptions,
  res: Response
): StreamableHTTPServerTransport | null {
  const { sessionStore } = options;

  if (!sessionId) {
    respondMissingSession(res);
    return null;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    respondSessionNotFound(res);
    return null;
  }

  sessionStore.touch(sessionId);
  return session.transport;
}

const MCP_PROTOCOL_VERSION_HEADER = 'mcp-protocol-version';

const MCP_PROTOCOL_VERSIONS = {
  defaultVersion: '2025-11-25',
  supported: new Set<string>(['2025-11-25']),
};

function getHeaderValue(req: Request, headerNameLower: string): string | null {
  const value = req.headers[headerNameLower];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function setHeaderValue(
  req: Request,
  headerNameLower: string,
  value: string
): void {
  // Express exposes req.headers as a plain object, but the type is readonly-ish.
  req.headers[headerNameLower] = value;
}

export function ensureMcpProtocolVersionHeader(
  req: Request,
  res: Response
): boolean {
  const raw = getHeaderValue(req, MCP_PROTOCOL_VERSION_HEADER);
  const version = raw?.trim();

  if (!version) {
    setHeaderValue(
      req,
      MCP_PROTOCOL_VERSION_HEADER,
      MCP_PROTOCOL_VERSIONS.defaultVersion
    );
    return true;
  }

  if (!MCP_PROTOCOL_VERSIONS.supported.has(version)) {
    sendJsonRpcError(
      res,
      -32600,
      `Unsupported MCP-Protocol-Version: ${version}`,
      400
    );
    return false;
  }

  return true;
}

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

async function handlePost(
  req: RequestWithUnknownBody,
  res: Response,
  options: McpSessionOptions
): Promise<void> {
  ensurePostAcceptHeader(req);
  if (!ensureMcpProtocolVersionHeader(req, res)) return;

  const sessionId = getSessionId(req);
  const payload = validatePostPayload(req.body, res);
  if (!payload) return;

  logPostRequest(payload, sessionId, options);

  const transport = await resolveTransportForPost({
    res,
    body: payload,
    sessionId,
    options,
  });
  if (!transport) return;

  await handleTransportRequest(transport, req, res, payload);
}

async function handleGet(
  req: Request,
  res: Response,
  options: McpSessionOptions
): Promise<void> {
  if (!ensureMcpProtocolVersionHeader(req, res)) return;
  if (!acceptsEventStream(req)) {
    res.status(406).json({
      error: 'Not Acceptable',
      code: 'ACCEPT_NOT_SUPPORTED',
    });
    return;
  }

  const transport = resolveSessionTransport(getSessionId(req), options, res);
  if (!transport) return;

  await handleTransportRequest(transport, req, res);
}

async function handleDelete(
  req: Request,
  res: Response,
  options: McpSessionOptions
): Promise<void> {
  if (!ensureMcpProtocolVersionHeader(req, res)) return;

  const transport = resolveSessionTransport(getSessionId(req), options, res);
  if (!transport) return;

  await handleTransportRequest(transport, req, res);
}

export function registerMcpRoutes(
  app: Express,
  options: McpSessionOptions
): void {
  app.post(
    '/mcp',
    wrapAsync((req, res) => handlePost(req, res, options))
  );
  app.get(
    '/mcp',
    wrapAsync((req, res) => handleGet(req, res, options))
  );
  app.delete(
    '/mcp',
    wrapAsync((req, res) => handleDelete(req, res, options))
  );
}
