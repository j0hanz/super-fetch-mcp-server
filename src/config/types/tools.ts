import type { ToolContentBlock } from './runtime.js';

export interface FetchUrlInput {
  url: string;
}

export interface ErrorResponse {
  error: {
    message: string;
    code: string;
    statusCode: number;
    details?: Record<string, unknown>;
    stack?: string;
  };
}

export interface ToolErrorResponse {
  [x: string]: unknown;
  content: ToolContentBlock[];
  structuredContent: {
    error: string;
    url: string;
  };
  isError: true;
}

export interface ToolResponseBase {
  [x: string]: unknown;
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
