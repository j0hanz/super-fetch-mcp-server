import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FetchError } from '../dist/errors.js';
import { readResponseText } from '../dist/fetch.js';

function createStreamResponse(text) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

describe('readResponseText', () => {
  it('reads text and size from responses', async () => {
    const response = new Response('hello', {
      status: 200,
      headers: { 'content-length': '5' },
    });

    const result = await readResponseText(response, 'https://example.com', 10);

    assert.equal(result.text, 'hello');
    assert.equal(result.size, 5);
  });

  it('rejects responses that exceed the content-length limit', async () => {
    const response = new Response('hello', {
      status: 200,
      headers: { 'content-length': '100' },
    });

    await assert.rejects(
      () => readResponseText(response, 'https://example.com', 10),
      (error) => {
        assert.ok(error instanceof FetchError);
        assert.equal(
          error.message,
          'Response exceeds maximum size of 10 bytes'
        );
        return true;
      }
    );
  });

  it('rejects streamed responses that exceed the byte limit', async () => {
    const response = createStreamResponse('hello world');

    await assert.rejects(
      () => readResponseText(response, 'https://example.com', 5),
      (error) => {
        assert.ok(error instanceof FetchError);
        assert.equal(error.message, 'Response exceeds maximum size of 5 bytes');
        return true;
      }
    );
  });

  it('returns an abort error when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const response = createStreamResponse('hello');

    await assert.rejects(
      () =>
        readResponseText(
          response,
          'https://example.com',
          1024,
          controller.signal
        ),
      (error) => {
        assert.ok(error instanceof FetchError);
        assert.equal(error.statusCode, 499);
        assert.equal(error.message, 'Request was aborted during response read');
        return true;
      }
    );
  });

  it('handles responses without a body stream', async () => {
    const response = new Response(null, { status: 204 });

    const result = await readResponseText(response, 'https://example.com', 10);

    assert.equal(result.text, '');
    assert.equal(result.size, 0);
  });

  it('decodes non-UTF8 content when encoding is provided', async () => {
    // 0xE9 is 'é' in iso-8859-1
    const buffer = new Uint8Array([0xe9]);
    const response = new Response(buffer, {
      status: 200,
      headers: { 'content-length': '1' },
    });

    const result = await readResponseText(
      response,
      'https://example.com',
      10,
      undefined,
      'iso-8859-1'
    );

    assert.equal(result.text, 'é');
  });

  it('defaults to UTF-8 without encoding, producing replacement chars for invalid sequences', async () => {
    // 0xE9 is invalid in UTF-8 start byte
    const buffer = new Uint8Array([0xe9]);
    const response = new Response(buffer, {
      status: 200,
      headers: { 'content-length': '1' },
    });

    const result = await readResponseText(response, 'https://example.com', 10);

    // \ufffd is the replacement character
    assert.equal(result.text, '\ufffd');
  });
});
