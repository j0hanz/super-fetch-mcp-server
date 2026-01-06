import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCorsMiddleware } from '../dist/http/cors.js';

describe('createCorsMiddleware', () => {
  it('handles OPTIONS preflight', () => {
    const middleware = createCorsMiddleware();

    const headers: Record<string, string> = {};
    let statusSent: number | undefined;
    const res = {
      header: (key: string, value: string) => {
        headers[key] = value;
        return res;
      },
      sendStatus: (code: number) => {
        statusSent = code;
        return res;
      },
    };
    const req = {
      headers: { origin: 'https://client.test' },
      method: 'OPTIONS',
    };
    let nextCalled = 0;
    const next = () => {
      nextCalled += 1;
    };

    middleware(req as never, res as never, next);

    assert.equal(statusSent, 200);
    assert.equal(nextCalled, 0);
  });

  it('passes through non-OPTIONS requests', () => {
    const middleware = createCorsMiddleware();

    const res = {
      header: () => res,
      sendStatus: () => res,
    };
    const req = {
      headers: { origin: 'https://client.test' },
      method: 'POST',
    };
    let nextCalled = 0;
    const next = () => {
      nextCalled += 1;
    };

    middleware(req as never, res as never, next);

    assert.equal(nextCalled, 1);
  });
});
