import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptsEventStream,
  ensurePostAcceptHeader,
} from '../dist/http/accept-policy.js';

describe('accept-policy', () => {
  it('defaults POST Accept when missing', () => {
    const req = { headers: {} } as never;
    ensurePostAcceptHeader(req);
    assert.equal(req.headers.accept, 'application/json, text/event-stream');
  });

  it('defaults POST Accept when */*', () => {
    const req = { headers: { accept: '*/*' } } as never;
    ensurePostAcceptHeader(req);
    assert.equal(req.headers.accept, 'application/json, text/event-stream');
  });

  it('defaults POST Accept when incomplete', () => {
    const req = { headers: { accept: 'application/json' } } as never;
    ensurePostAcceptHeader(req);
    assert.equal(req.headers.accept, 'application/json, text/event-stream');
  });

  it('preserves POST Accept when already includes JSON and SSE', () => {
    const req = {
      headers: { accept: 'application/json, text/event-stream' },
    } as never;
    ensurePostAcceptHeader(req);
    assert.equal(req.headers.accept, 'application/json, text/event-stream');
  });

  it('acceptsEventStream returns true only when Accept includes SSE', () => {
    assert.equal(acceptsEventStream({ headers: {} } as never), false);
    assert.equal(
      acceptsEventStream({ headers: { accept: 'text/event-stream' } } as never),
      true
    );
  });
});
