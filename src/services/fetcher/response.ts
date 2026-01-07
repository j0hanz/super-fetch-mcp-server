import { FetchError } from '../../errors/app-error.js';

function assertContentLengthWithinLimit(
  response: Response,
  url: string,
  maxBytes: number
): void {
  const contentLengthHeader = response.headers.get('content-length');
  if (!contentLengthHeader) return;
  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (Number.isNaN(contentLength) || contentLength <= maxBytes) {
    return;
  }

  void response.body?.cancel();

  throw new FetchError(
    `Response exceeds maximum size of ${maxBytes} bytes`,
    url
  );
}

interface StreamReadState {
  decoder: TextDecoder;
  parts: string[];
  total: number;
}

function createReadState(): StreamReadState {
  return {
    decoder: new TextDecoder(),
    parts: [],
    total: 0,
  };
}

function appendChunk(
  state: StreamReadState,
  chunk: Uint8Array,
  maxBytes: number,
  url: string
): void {
  const buffer = Buffer.from(chunk);
  state.total += buffer.length;

  if (state.total > maxBytes) {
    throw new FetchError(
      `Response exceeds maximum size of ${maxBytes} bytes`,
      url
    );
  }

  const decoded = state.decoder.decode(buffer, { stream: true });
  if (decoded) state.parts.push(decoded);
}

function finalizeRead(state: StreamReadState): void {
  const decoded = state.decoder.decode();
  if (decoded) state.parts.push(decoded);
}

function createAbortError(url: string): FetchError {
  return new FetchError('Request was aborted during response read', url, 499, {
    reason: 'aborted',
  });
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; size: number }> {
  const state = createReadState();
  const reader = stream.getReader();

  try {
    if (signal?.aborted) {
      await reader.cancel();
      throw createAbortError(url);
    }

    let result = await reader.read();
    while (!result.done) {
      appendChunk(state, result.value, maxBytes, url);

      if (signal?.aborted) {
        await reader.cancel();
        throw createAbortError(url);
      }

      result = await reader.read();
    }
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError(url);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  finalizeRead(state);
  return { text: state.parts.join(''), size: state.total };
}

export async function readResponseText(
  response: Response,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ text: string; size: number }> {
  assertContentLengthWithinLimit(response, url, maxBytes);

  if (!response.body) {
    const text = await response.text();
    const size = Buffer.byteLength(text);
    if (size > maxBytes) {
      throw new FetchError(
        `Response exceeds maximum size of ${maxBytes} bytes`,
        url
      );
    }
    return { text, size };
  }

  return readStreamWithLimit(response.body, url, maxBytes, signal);
}
