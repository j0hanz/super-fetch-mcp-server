import type {
  CallToolResult,
  ProgressNotificationParams,
} from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { logWarn } from './observability.js';

type ProgressToken = string | number;

export interface ToolExtra {
  signal?: AbortSignal;
  _meta?: {
    progressToken?: ProgressToken | undefined;
  };
  sendNotification?: (notification: {
    method: 'notifications/progress';
    params: ProgressNotificationParams;
  }) => Promise<void>;
}

export type ToolResult<T> = CallToolResult & {
  structuredContent: T;
};

export function buildToolErrorResponse(
  message: string,
  code: string | number = ErrorCode.InternalError
): ToolResult<{ error: string; code: string | number }> {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { error: message, code },
    isError: true,
  };
}

function canSendProgress(extra: ToolExtra): extra is ToolExtra & {
  _meta: { progressToken: ProgressToken };
  sendNotification: NonNullable<ToolExtra['sendNotification']>;
} {
  return (
    extra._meta?.progressToken !== undefined &&
    extra.sendNotification !== undefined
  );
}

async function sendProgressNotification(
  extra: ToolExtra,
  params: ProgressNotificationParams
): Promise<void> {
  if (!canSendProgress(extra)) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params,
    });
  } catch (error) {
    logWarn('Failed to send progress notification', { error });
  }
}

async function withProgress<T>(
  message: string,
  extra: ToolExtra,
  run: () => Promise<T>,
  getCompletionMessage?: (result: T) => string | undefined
): Promise<T> {
  if (!canSendProgress(extra)) {
    return await run();
  }
  const token = extra._meta.progressToken;

  // Initial progress (0/1)
  const total = 1;
  await sendProgressNotification(extra, {
    progressToken: token,
    progress: 0,
    total,
    message,
  });

  try {
    const result = await run();
    const endMessage = getCompletionMessage?.(result) ?? message;
    // Final progress (1/1)
    await sendProgressNotification(extra, {
      progressToken: token,
      progress: total,
      total,
      message: endMessage,
    });
    return result;
  } catch (error) {
    // Ensure progress is marked complete even on error, using the original message
    await sendProgressNotification(extra, {
      progressToken: token,
      progress: total,
      total,
      message,
    });
    throw error;
  }
}

export function wrapToolHandler<Args, Result>(
  handler: (args: Args, extra: ToolExtra) => Promise<ToolResult<Result>>,
  options: {
    guard?: (() => boolean) | undefined;
    progressMessage?: (args: Args) => string;
    completionMessage?: (
      args: Args,
      result: ToolResult<Result>
    ) => string | undefined;
  }
): (args: Args, extra?: ToolExtra) => Promise<ToolResult<Result>> {
  return async (args: Args, extra?: ToolExtra) => {
    const resolvedExtra = extra ?? {};
    if (options.guard && !options.guard()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Client not initialized; wait for notifications/initialized'
      );
    }

    if (options.progressMessage) {
      const message = options.progressMessage(args);
      const { completionMessage } = options;
      const completionFn = completionMessage
        ? (result: ToolResult<Result>) => completionMessage(args, result)
        : undefined;
      return await withProgress(
        message,
        resolvedExtra,
        () => handler(args, resolvedExtra),
        completionFn
      );
    }

    return await handler(args, resolvedExtra);
  };
}
