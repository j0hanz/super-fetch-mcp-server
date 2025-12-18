import { config } from '../config/index.js';

import { logWarn } from '../services/logger.js';

const SAFE_BOUNDARY_THRESHOLD = 0.9;

export function truncateHtml(html: string): string {
  const maxSize = config.constants.maxHtmlSize;

  if (html.length <= maxSize) {
    return html;
  }

  logWarn('HTML content exceeds maximum size, truncating at safe boundary', {
    size: html.length,
    maxSize,
  });

  const lastTagEnd = html.lastIndexOf('>', maxSize);
  const minimumAcceptablePosition = maxSize * SAFE_BOUNDARY_THRESHOLD;

  if (lastTagEnd !== -1 && lastTagEnd > minimumAcceptablePosition) {
    return html.substring(0, lastTagEnd + 1);
  }

  return html.substring(0, maxSize);
}
