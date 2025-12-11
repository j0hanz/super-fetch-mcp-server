/**
 * Tool input types - used for type safety in tool handlers
 */

/** Common request options shared across tools */
export interface RequestOptions {
  /** Custom HTTP headers for the request */
  customHeaders?: Record<string, string>;
  /** Request timeout in milliseconds (1000-60000) */
  timeout?: number;
  /** Number of retry attempts (1-10) */
  retries?: number;
}

export interface FetchUrlInput extends RequestOptions {
  url: string;
  extractMainContent?: boolean;
  includeMetadata?: boolean;
  maxContentLength?: number;
  format?: 'jsonl' | 'markdown';
}

export interface FetchLinksInput extends RequestOptions {
  url: string;
  includeExternal?: boolean;
  includeInternal?: boolean;
  /** Maximum number of links to return */
  maxLinks?: number;
  /** Regex pattern to filter links (matches against href) */
  filterPattern?: string;
  /** Include image links (img src attributes) */
  includeImages?: boolean;
}

export interface FetchMarkdownInput extends RequestOptions {
  url: string;
  extractMainContent?: boolean;
  includeMetadata?: boolean;
  /** Maximum content length in characters */
  maxContentLength?: number;
  /** Generate table of contents from headings */
  generateToc?: boolean;
}

export interface FetchUrlsInput extends RequestOptions {
  urls: string[];
  extractMainContent?: boolean;
  includeMetadata?: boolean;
  maxContentLength?: number;
  format?: 'jsonl' | 'markdown';
  concurrency?: number;
  continueOnError?: boolean;
}
