/**
 * Shared types for the transform pipeline.
 * Extracted to avoid circular dependencies between transform modules.
 */

/**
 * Metadata block for attaching source information to markdown output.
 */
export interface MetadataBlock {
  type: 'metadata';
  title?: string;
  description?: string;
  author?: string;
  url: string;
  fetchedAt: string;
}

/**
 * Article extracted by Readability.
 */
export interface ExtractedArticle {
  title?: string;
  byline?: string;
  content: string;
  textContent: string;
  excerpt?: string;
  siteName?: string;
}

/**
 * Metadata extracted from HTML meta tags.
 */
export interface ExtractedMetadata {
  title?: string;
  description?: string;
  author?: string;
  image?: string;
  publishedAt?: string;
  modifiedAt?: string;
}

/**
 * Result of content extraction (article + metadata).
 */
export interface ExtractionResult {
  article: ExtractedArticle | null;
  metadata: ExtractedMetadata;
}

/**
 * Result of HTML to markdown transformation.
 */
export interface MarkdownTransformResult {
  markdown: string;
  title: string | undefined;
  truncated: boolean;
}

/**
 * Options for transform operations.
 */
export interface TransformOptions {
  includeMetadata: boolean;
  signal?: AbortSignal;
}

/**
 * Telemetry event emitted during transform stages.
 */
export interface TransformStageEvent {
  v: 1;
  type: 'stage';
  stage: string;
  durationMs: number;
  url: string;
  requestId?: string;
  operationId?: string;
  truncated?: boolean;
}

/**
 * Context for tracking transform stage timing.
 */
export interface TransformStageContext {
  readonly stage: string;
  readonly startTime: number;
  readonly url: string;
}
