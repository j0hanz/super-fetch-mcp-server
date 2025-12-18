const CONSECUTIVE_WHITESPACE = /\s+/g;
const MIN_TRUNCATION_LENGTH = 4;
const TRUNCATION_SUFFIX = '...';

export function sanitizeText(text: string | null | undefined): string {
  if (text == null) return '';
  if (typeof text !== 'string') return String(text);

  return text.replace(CONSECUTIVE_WHITESPACE, ' ').trim();
}

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
