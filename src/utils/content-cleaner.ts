/**
 * Post-processing content cleaner for removing noise artifacts
 * that slip through Readability extraction.
 */

// Simplified noise patterns - essential patterns only
const NOISE_PATTERN = new RegExp(
  [
    // UI actions
    '^(share|copy|like|follow|subscribe|download|print|save)$',
    '^(copy to clipboard|copied!?|copy code|copy link)$',
    '^(show more|show less|load more|view more|read more|see all|view all)$',
    // Navigation
    '^(next|previous|prev|back|forward|home|menu|close|skip to)$',
    '^(table of contents|toc|on this page)$',
    // Empty/placeholder
    '^(loading\\.{0,3}|please wait\\.{0,3}|\\.{2,})$',
    '^(n\\/a|tbd|todo|coming soon|placeholder)$',
    // Counts (standalone)
    '^\\d+\\s*(comments?|replies?|likes?|shares?|views?)$',
    // Breadcrumbs
    '^[/\\\\>→»›]+$',
  ].join('|'),
  'i'
);

// Minimum lengths for different content types
const MIN_PARAGRAPH_LENGTH = 20;
const MIN_HEADING_LENGTH = 2;
const MIN_LIST_ITEM_LENGTH = 3;

// Maximum text length to test against regex patterns (ReDoS protection)
const MAX_REGEX_INPUT_LENGTH = 500;

/**
 * Check if text matches noise pattern
 */
function isNoiseText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > MAX_REGEX_INPUT_LENGTH) return false;
  return NOISE_PATTERN.test(trimmed);
}

/**
 * Clean paragraph text by removing noise
 */
export function cleanParagraph(text: string): string | null {
  const trimmed = text.trim();

  // Too short to be meaningful
  if (trimmed.length < MIN_PARAGRAPH_LENGTH) {
    // Allow very short paragraphs if they end with punctuation (likely real content)
    if (!/[.!?]$/.test(trimmed)) {
      return null;
    }
  }

  // Is noise content
  if (isNoiseText(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Clean heading text by removing noise and markdown link syntax
 */
export function cleanHeading(text: string): string | null {
  let cleaned = text.trim();

  // Too short
  if (cleaned.length < MIN_HEADING_LENGTH) {
    return null;
  }

  // Remove markdown link syntax: [Text](#anchor) -> Text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Remove trailing anchor links like "Link for this heading"
  cleaned = cleaned.replace(/\s*Link for (this heading|[\w\s]+)\s*$/i, '');

  // Remove trailing hash symbols often used for anchor links
  cleaned = cleaned.replace(/\s*#+\s*$/, '');

  // Is noise content
  if (isNoiseText(cleaned)) {
    return null;
  }

  return cleaned.trim();
}

/**
 * Clean list items by filtering out noise
 */
export function cleanListItems(items: string[]): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => {
      if (item.length < MIN_LIST_ITEM_LENGTH) return false;
      if (isNoiseText(item)) return false;
      return true;
    });
}

/**
 * Clean code block text - minimal cleaning to preserve code integrity
 */
export function cleanCodeBlock(code: string): string | null {
  const trimmed = code.trim();

  // Empty code block
  if (trimmed.length === 0) {
    return null;
  }

  // Very short code blocks that are likely just labels
  if (trimmed.length < 3 && !/^[{}[\]();<>]$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

/**
 * Remove common timestamp patterns from text (inline removal)
 */
export function removeInlineTimestamps(text: string): string {
  return text
    .replace(
      /\b\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago\b/gi,
      ''
    )
    .replace(
      /\b(updated|modified|edited|created|published)\s*:?\s*\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago\b/gi,
      ''
    )
    .replace(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}\b/gi,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}
