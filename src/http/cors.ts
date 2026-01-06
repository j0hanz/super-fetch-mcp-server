import type { NextFunction, Request, Response } from 'express';

/**
 * Creates a minimal CORS middleware.
 * MCP clients are not browser-based, so CORS is not needed.
 * This just handles OPTIONS preflight requests.
 */
export function createCorsMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  };
}
