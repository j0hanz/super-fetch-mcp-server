import type {
  MarkdownTransformResult,
  TransformOptions,
} from '../../config/types/content.js';

import { FetchError } from '../../errors/app-error.js';

import {
  endTransformStage,
  startTransformStage,
} from '../../services/telemetry.js';
import { getOrCreateTransformWorkerPool } from '../../services/transform-worker-pool.js';

import { throwIfAborted } from '../../utils/cancellation.js';

import { transformHtmlToMarkdownInProcess } from './content-transform-core.js';

export {
  createContentMetadataBlock,
  determineContentExtractionSource,
  isExtractionSufficient,
} from './content-transform-core.js';

export async function transformHtmlToMarkdown(
  html: string,
  url: string,
  options: TransformOptions
): Promise<MarkdownTransformResult> {
  const totalStage = startTransformStage(url, 'transform:total');
  let success = false;

  try {
    throwIfAborted(options.signal, url, 'transform:begin');

    const workerStage = startTransformStage(url, 'transform:worker');
    try {
      const pool = getOrCreateTransformWorkerPool();
      const result = await pool.transform(html, url, {
        includeMetadata: options.includeMetadata,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      success = true;
      return result;
    } catch (error: unknown) {
      if (error instanceof FetchError) {
        throw error;
      }

      // Stability-first: if worker infrastructure fails, fall back to in-process.
      throwIfAborted(options.signal, url, 'transform:worker-fallback');
      const fallback = transformHtmlToMarkdownInProcess(html, url, options);
      success = true;
      return fallback;
    } finally {
      endTransformStage(workerStage);
    }
  } finally {
    if (success) {
      endTransformStage(totalStage, { truncated: false });
    }
  }
}
