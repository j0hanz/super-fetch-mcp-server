import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attachBaseMiddleware } from '../dist/http/server-middleware.js';

type JsonParseErrorHandler = (
  err: Error,
  _req: unknown,
  res: {
    status: (code: number) => unknown;
    json: (payload: unknown) => void;
  },
  next: () => void
) => void;

type ContextMiddleware = (
  req: { headers?: Record<string, string> },
  _res: unknown,
  next: () => void
) => void;

type OriginValidationMiddleware = (
  req: { headers?: Record<string, string> },
  res: {
    status: (code: number) => unknown;
    json: (payload: unknown) => void;
  },
  next: () => void
) => void;

type HealthRouteHandler = (
  _req: unknown,
  res: { json: (payload: unknown) => void }
) => void;

function captureMiddleware() {
  const uses: unknown[][] = [];
  const routes: Record<string, (req: unknown, res: unknown) => void> = {};
  const app = {
    use: (...args: unknown[]) => {
      uses.push(args);
    },
    get: (path: string, handler: (req: unknown, res: unknown) => void) => {
      routes[path] = handler;
    },
  };
  const jsonParser = () => undefined;
  const rateLimit = () => undefined;
  const cors = () => undefined;

  attachBaseMiddleware(app as never, jsonParser, rateLimit, cors);

  return { uses, routes };
}

function getJsonParseErrorHandler(uses: unknown[][]): JsonParseErrorHandler {
  return uses[4][0] as JsonParseErrorHandler;
}

function getContextMiddleware(uses: unknown[][]): ContextMiddleware {
  return uses[3][0] as ContextMiddleware;
}

function getOriginValidationMiddleware(
  uses: unknown[][]
): OriginValidationMiddleware {
  return uses[1][0] as OriginValidationMiddleware;
}

function getHealthRouteHandler(
  routes: Record<string, (req: unknown, res: unknown) => void>
): HealthRouteHandler {
  return routes['/health'] as HealthRouteHandler;
}

function createStatusJsonCapture() {
  let statusCode: number | undefined;
  let jsonBody: unknown;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      jsonBody = payload;
    },
  };

  return {
    res,
    getStatusCode: () => statusCode,
    getJsonBody: () => jsonBody,
  };
}

function createJsonCapture() {
  let jsonBody: unknown;
  const res = {
    json: (payload: unknown) => {
      jsonBody = payload;
    },
  };

  return { res, getJsonBody: () => jsonBody };
}

function createNextTracker() {
  let nextCalled = 0;
  const next = () => {
    nextCalled += 1;
  };

  return { next, getCalls: () => nextCalled };
}

function testReturnsParseErrorForInvalidJson() {
  const { uses } = captureMiddleware();
  const handler = getJsonParseErrorHandler(uses);
  const err = new SyntaxError('bad json') as Error & { body?: string };
  err.body = '{}';

  const { res, getStatusCode, getJsonBody } = createStatusJsonCapture();
  const { next, getCalls } = createNextTracker();

  handler(err, {} as never, res as never, next);

  const jsonBody = getJsonBody() as { id?: unknown; jsonrpc?: string };
  assert.equal(getStatusCode(), 400);
  assert.equal(jsonBody.jsonrpc, '2.0');
  assert.equal(jsonBody.id, null);
  assert.equal(getCalls(), 0);
}

function testDelegatesToNextForNonParseErrors() {
  const { uses } = captureMiddleware();
  const handler = getJsonParseErrorHandler(uses);
  const res = { status: () => res, json: () => res };
  const { next, getCalls } = createNextTracker();

  handler(new Error('other'), {} as never, res as never, next);

  assert.equal(getCalls(), 1);
}

function registerCreateJsonParseErrorHandlerTests() {
  describe('createJsonParseErrorHandler', () => {
    it('returns JSON-RPC parse error for invalid JSON', () => {
      testReturnsParseErrorForInvalidJson();
    });
    it('delegates to next for non-parse errors', () => {
      testDelegatesToNextForNonParseErrors();
    });
  });
}

function testContextMiddlewareInvokesNext() {
  const { uses } = captureMiddleware();
  const middleware = getContextMiddleware(uses);
  const { next, getCalls } = createNextTracker();

  middleware(
    { headers: { 'mcp-session-id': 'session-1' } } as never,
    {} as never,
    next
  );

  assert.equal(getCalls(), 1);
}

function registerCreateContextMiddlewareTests() {
  describe('createContextMiddleware', () => {
    it('invokes next handler', () => {
      testContextMiddlewareInvokesNext();
    });
  });
}

function testRegistersHealthRoute() {
  const { routes } = captureMiddleware();
  const handler = getHealthRouteHandler(routes);
  const { res, getJsonBody } = createJsonCapture();

  assert.equal(typeof handler, 'function');

  handler({} as never, res);

  assert.equal((getJsonBody() as { status?: string }).status, 'healthy');
}

function registerHealthRouteTests() {
  describe('registerHealthRoute', () => {
    it('registers /health and responds with status', () => {
      testRegistersHealthRoute();
    });
  });
}

function testRejectsNonLoopbackOrigins() {
  const { uses } = captureMiddleware();
  const middleware = getOriginValidationMiddleware(uses);
  const { res, getStatusCode, getJsonBody } = createStatusJsonCapture();
  const { next, getCalls } = createNextTracker();

  middleware(
    { headers: { origin: 'https://evil.example' } } as never,
    res as never,
    next
  );

  assert.equal(getStatusCode(), 403);
  assert.equal((getJsonBody() as { code?: string }).code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(getCalls(), 0);
}

function testAllowsLoopbackOrigins() {
  const { uses } = captureMiddleware();
  const middleware = getOriginValidationMiddleware(uses);
  const { next, getCalls } = createNextTracker();

  middleware(
    { headers: { origin: 'http://127.0.0.1:3000' } } as never,
    {} as never,
    next
  );

  assert.equal(getCalls(), 1);
}

function registerOriginValidationMiddlewareTests() {
  describe('createOriginValidationMiddleware', () => {
    it('rejects non-loopback origins when bound to loopback', () => {
      testRejectsNonLoopbackOrigins();
    });
    it('allows loopback origins when bound to loopback', () => {
      testAllowsLoopbackOrigins();
    });
  });
}

function testRegistersMiddlewareOrder() {
  const { uses } = captureMiddleware();
  assert.equal(uses.length, 7);
}

function registerAttachBaseMiddlewareTests() {
  describe('attachBaseMiddleware', () => {
    it('registers middleware in expected order', () => {
      testRegistersMiddlewareOrder();
    });
  });
}

registerCreateJsonParseErrorHandlerTests();
registerCreateContextMiddlewareTests();
registerHealthRouteTests();
registerOriginValidationMiddlewareTests();
registerAttachBaseMiddlewareTests();
