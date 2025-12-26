import { config } from '../../config/index.js';

import { normalizeHeaderRecord } from '../../utils/header-normalizer.js';

export function sanitizeHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  return normalizeHeaderRecord(headers, config.security.blockedHeaders);
}
