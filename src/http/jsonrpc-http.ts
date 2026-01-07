import type { Response } from 'express';

export function sendJsonRpcError(
  res: Response,
  code: number,
  message: string,
  status = 400
): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id: null,
  });
}
