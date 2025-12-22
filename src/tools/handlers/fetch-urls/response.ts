import type {
  BatchResponseContent,
  BatchSummary,
  BatchUrlResult,
  ToolResponse,
} from '../../../config/types.js';

import { normalizeToolErrorCode } from '../../../utils/tool-error-handler.js';

function normalizeBatchResults(results: BatchUrlResult[]): BatchUrlResult[] {
  return results.map((result) => {
    if (!result.errorCode) return result;
    const normalized = normalizeToolErrorCode(result.errorCode);
    return normalized === result.errorCode
      ? result
      : { ...result, errorCode: normalized };
  });
}

export function createBatchResponse(
  results: BatchUrlResult[]
): ToolResponse<BatchResponseContent> {
  const normalizedResults = normalizeBatchResults(results);

  const summary: BatchSummary = {
    total: normalizedResults.length,
    successful: normalizedResults.filter((result) => result.success).length,
    failed: normalizedResults.filter((result) => !result.success).length,
    cached: normalizedResults.filter((result) => result.cached).length,
    totalContentBlocks: normalizedResults.reduce(
      (sum, result) => sum + (result.contentBlocks ?? 0),
      0
    ),
  };

  const structuredContent: BatchResponseContent = {
    results: normalizedResults,
    summary,
    fetchedAt: new Date().toISOString(),
  };

  const resourceLinks = normalizedResults
    .filter(
      (result): result is BatchUrlResult & { resourceUri: string } =>
        typeof result.resourceUri === 'string'
    )
    .map((result) => ({
      type: 'resource_link' as const,
      uri: result.resourceUri,
      name: `Fetched content for ${result.url}`,
      mimeType: result.resourceMimeType,
    }));

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
      ...resourceLinks,
    ],
    structuredContent,
  };
}
