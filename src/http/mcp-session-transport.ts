import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export function createTimeoutController(): {
  clear: () => void;
  set: (timeout: NodeJS.Timeout | null) => void;
} {
  let initTimeout: NodeJS.Timeout | null = null;
  return {
    clear: (): void => {
      if (!initTimeout) return;
      clearTimeout(initTimeout);
      initTimeout = null;
    },
    set: (timeout: NodeJS.Timeout | null): void => {
      initTimeout = timeout;
    },
  };
}

export function createTransportAdapter(
  transport: StreamableHTTPServerTransport
): Transport {
  const adapter = buildTransportAdapter(transport);
  attachTransportAccessors(adapter, transport);
  return adapter;
}

function buildTransportAdapter(
  transport: StreamableHTTPServerTransport
): Transport {
  return {
    start: () => transport.start(),
    send: (message, options) => transport.send(message, options),
    close: () => transport.close(),
  };
}

function createAccessorDescriptor<T>(
  getter: () => T,
  setter?: (value: T) => void
): PropertyDescriptor {
  return {
    get: getter,
    ...(setter ? { set: setter } : {}),
    enumerable: true,
    configurable: true,
  };
}

type CloseHandler = (() => void) | undefined;
type ErrorHandler = ((error: Error) => void) | undefined;
type MessageHandler = Transport['onmessage'];

function createOnCloseDescriptor(
  transport: StreamableHTTPServerTransport
): PropertyDescriptor {
  return createAccessorDescriptor(
    () => transport.onclose,
    (handler: CloseHandler) => {
      transport.onclose = handler;
    }
  );
}

function createOnErrorDescriptor(
  transport: StreamableHTTPServerTransport
): PropertyDescriptor {
  return createAccessorDescriptor(
    () => transport.onerror,
    (handler: ErrorHandler) => {
      transport.onerror = handler;
    }
  );
}

function createOnMessageDescriptor(
  transport: StreamableHTTPServerTransport
): PropertyDescriptor {
  return createAccessorDescriptor(
    () => transport.onmessage,
    (handler: MessageHandler) => {
      transport.onmessage = handler;
    }
  );
}

function attachTransportAccessors(
  adapter: Transport,
  transport: StreamableHTTPServerTransport
): void {
  Object.defineProperties(adapter, {
    onclose: createOnCloseDescriptor(transport),
    onerror: createOnErrorDescriptor(transport),
    onmessage: createOnMessageDescriptor(transport),
    sessionId: createAccessorDescriptor(() => transport.sessionId),
  });
}
