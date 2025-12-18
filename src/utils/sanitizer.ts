/** Pattern to match consecutive whitespace characters */
const CONSECUTIVE_WHITESPACE = /\s+/g;

/** Minimum length for truncation ellipsis */
const MIN_TRUNCATION_LENGTH = 4;

/** Truncation suffix appended to shortened text */
const TRUNCATION_SUFFIX = '...';

/**
 * Sanitizes text by normalizing whitespace and trimming.
 * Handles null/undefined input safely.
 */
export function sanitizeText(text: string | null | undefined): string {
  if (text == null) return '';
  if (typeof text !== 'string') return String(text);

  return text.replace(CONSECUTIVE_WHITESPACE, ' ').trim();
}

/**
 * Truncates text to specified maximum length with ellipsis.
 * Preserves original text if within length limit.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum allowed length including ellipsis
 * @returns Truncated text with ellipsis or original if within limits
 */
export function truncateText(text: string, maxLength: number): string {
  if (maxLength < MIN_TRUNCATION_LENGTH) {
    return text.length > 0 ? text.charAt(0) : '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  const truncationPoint = maxLength - TRUNCATION_SUFFIX.length;
  return `${text.substring(0, truncationPoint)}${TRUNCATION_SUFFIX}`;
}
