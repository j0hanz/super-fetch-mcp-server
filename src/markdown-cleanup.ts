/**
 * Markdown cleanup utilities for post-processing converted content.
 * Provides fence-aware pattern matching and cleanup operations.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fence Detection Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a line starts a code fence (``` or ~~~).
 */
function isFenceStart(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

/**
 * Check if a line ends a code fence matching the given fence marker.
 */
function isFenceEnd(line: string, fenceMarker: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith(fenceMarker) &&
    trimmed.slice(fenceMarker.length).trim() === ''
  );
}

/**
 * Extract the fence marker (``` or ~~~) from a fence start line.
 */
function extractFenceMarker(line: string): string {
  const trimmed = line.trimStart();
  // Match consecutive ` or ~ characters
  const match = /^(`{3,}|~{3,})/.exec(trimmed);
  return match?.[1] ?? '```';
}

// ─────────────────────────────────────────────────────────────────────────────
// Fence-Aware Content Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split markdown into segments, marking which are inside fenced code blocks.
 * Returns array of { content: string, inFence: boolean } segments.
 */
function splitByFences(
  content: string
): { content: string; inFence: boolean }[] {
  const lines = content.split('\n');
  const segments: { content: string; inFence: boolean }[] = [];
  let currentLines: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    if (!inFence && isFenceStart(line)) {
      // Push any accumulated non-fence content
      if (currentLines.length > 0) {
        segments.push({ content: currentLines.join('\n'), inFence: false });
        currentLines = [];
      }
      // Start fence
      inFence = true;
      fenceMarker = extractFenceMarker(line);
      currentLines.push(line);
    } else if (inFence && isFenceEnd(line, fenceMarker)) {
      // End fence
      currentLines.push(line);
      segments.push({ content: currentLines.join('\n'), inFence: true });
      currentLines = [];
      inFence = false;
      fenceMarker = '';
    } else {
      currentLines.push(line);
    }
  }

  // Push remaining content
  if (currentLines.length > 0) {
    segments.push({ content: currentLines.join('\n'), inFence });
  }

  return segments;
}

/**
 * Apply cleanup patterns only to non-fenced content.
 */
function applyPatternOutsideFences(
  content: string,
  pattern: RegExp,
  replacement: string | ((...args: string[]) => string)
): string {
  const segments = splitByFences(content);
  return segments
    .map((seg) => {
      if (seg.inFence) return seg.content;
      if (typeof replacement === 'string') {
        return seg.content.replace(pattern, replacement);
      }
      return seg.content.replace(pattern, replacement);
    })
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Line Filtering with Fence Awareness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Track state when filtering lines with fence and TOC awareness.
 */
interface LineFilterState {
  inFence: boolean;
  fenceMarker: string;
  skipTocBlock: boolean;
}

/**
 * Process a line for fence state changes.
 * Returns true if line was handled (pushed to filtered), false otherwise.
 */
function handleFenceTransition(
  line: string,
  state: LineFilterState,
  filtered: string[]
): boolean {
  if (!state.inFence && isFenceStart(line)) {
    state.inFence = true;
    state.fenceMarker = extractFenceMarker(line);
    filtered.push(line);
    return true;
  }
  if (state.inFence && isFenceEnd(line, state.fenceMarker)) {
    state.inFence = false;
    state.fenceMarker = '';
    filtered.push(line);
    return true;
  }
  if (state.inFence) {
    filtered.push(line);
    return true;
  }
  return false;
}

/**
 * Check if a line is part of a TOC block and should be skipped.
 */
function shouldSkipTocLine(
  line: string,
  prevLine: string,
  nextLine: string,
  tocPattern: RegExp
): boolean {
  if (!tocPattern.test(line)) return false;
  const prevIsToc = tocPattern.test(prevLine) || prevLine.trim() === '';
  const nextIsToc = tocPattern.test(nextLine) || nextLine.trim() === '';
  return prevIsToc || nextIsToc;
}

/**
 * Filter lines with fence and TOC awareness.
 */
function filterLinesWithFenceAwareness(
  lines: string[],
  tocPattern: RegExp
): string[] {
  const filtered: string[] = [];
  const state: LineFilterState = {
    inFence: false,
    fenceMarker: '',
    skipTocBlock: false,
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    // Handle fence transitions
    if (handleFenceTransition(line, state, filtered)) {
      continue;
    }

    const prevLine = i > 0 ? (lines[i - 1] ?? '') : '';
    const nextLine = i < lines.length - 1 ? (lines[i + 1] ?? '') : '';

    // TOC block handling
    if (shouldSkipTocLine(line, prevLine, nextLine, tocPattern)) {
      state.skipTocBlock = true;
      continue;
    }
    if (line.trim() === '' && state.skipTocBlock) {
      state.skipTocBlock = false;
      continue;
    }
    state.skipTocBlock = false;
    filtered.push(line);
  }

  return filtered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Cleanup Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean up common markdown artifacts and formatting issues.
 * Applies fixes for orphan headings, skip links, TOC blocks, and spacing.
 */
export function cleanupMarkdownArtifacts(content: string): string {
  let result = content;

  const fixOrphanHeadings = (text: string): string => {
    // Only apply to non-fenced content
    return applyPatternOutsideFences(
      text,
      /^(.*?)(#{1,6})\s*(?:\r?\n){2}([A-Z][^\r\n]+?)(?:\r?\n)/gm,
      (_match: string, prefix: string, hashes: string, heading: string) => {
        if (heading.length > 150) {
          return _match;
        }
        const trimmedPrefix = prefix.trim();
        if (trimmedPrefix === '') {
          return `${hashes} ${heading}\n\n`;
        }
        return `${trimmedPrefix}\n\n${hashes} ${heading}\n\n`;
      }
    );
  };

  result = fixOrphanHeadings(result);
  // Empty headings - apply only outside fences
  result = applyPatternOutsideFences(
    result,
    /^#{1,6}[ \t\u00A0]*$\r?\n?/gm,
    ''
  );

  const zeroWidthAnchorLink = /\[(?:\s|\u200B)*\]\(#[^)]*\)\s*/g;

  result = result.replace(zeroWidthAnchorLink, '');
  result = result.replace(
    /^\[Skip to (?:main )?content\]\(#[^)]*\)\s*$/gim,
    ''
  );
  result = result.replace(
    /^\[Skip to (?:main )?navigation\]\(#[^)]*\)\s*$/gim,
    ''
  );
  result = result.replace(/^\[Skip link\]\(#[^)]*\)\s*$/gim, '');
  // Heading followed by fence - safe outside fences
  result = applyPatternOutsideFences(
    result,
    /(^#{1,6}\s+\w+)```/gm,
    '$1\n\n```'
  );
  result = applyPatternOutsideFences(
    result,
    /(^#{1,6}\s+\w*[A-Z])([A-Z][a-z])/gm,
    '$1\n\n$2'
  );
  result = applyPatternOutsideFences(
    result,
    /(^#{1,6}\s[^\n]*)\n([^\n])/gm,
    '$1\n\n$2'
  );

  // TOC filtering - fence-aware line processing
  const tocLinkLine = /^- \[[^\]]+\]\(#[^)]+\)\s*$/;
  const lines = result.split('\n');
  const filtered = filterLinesWithFenceAwareness(lines, tocLinkLine);

  result = filtered.join('\n');

  result = result.replace(/\]\(([^)]+)\)\[/g, ']($1)\n\n[');
  result = result.replace(/^Was this page helpful\??\s*$/gim, '');
  result = result.replace(/(`[^`]+`)\s*\\-\s*/g, '$1 - ');
  result = result.replace(/\\([[]])/g, '$1');
  // List formatting - safe to apply globally as patterns don't match fence content
  result = result.replace(/([^\n])\n([-*+] )/g, '$1\n\n$2');
  result = result.replace(/(\S)\n(\d+\. )/g, '$1\n\n$2');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Heading Promotion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common heading keywords that suggest a line should be a heading.
 */
const HEADING_KEYWORDS = new Set([
  'overview',
  'introduction',
  'summary',
  'conclusion',
  'prerequisites',
  'requirements',
  'installation',
  'configuration',
  'usage',
  'features',
  'limitations',
  'troubleshooting',
  'faq',
  'resources',
  'references',
  'changelog',
  'license',
  'acknowledgments',
  'appendix',
]);

/**
 * Check if a line looks like it should be a heading (title case, keyword, etc.)
 */
function isLikelyHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (/^[-*+•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (/^\[.*\]\(.*\)$/.test(trimmed)) return false;
  if (/^(?:example|note|tip|warning|important|caution):\s+\S/i.test(trimmed)) {
    return true;
  }
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && words.length <= 6) {
    const isTitleCase = words.every(
      (w) =>
        /^[A-Z][a-z]*$/.test(w) || /^(?:and|or|the|of|in|for|to|a)$/i.test(w)
    );
    if (isTitleCase) return true;
  }
  if (words.length === 1) {
    const lower = trimmed.toLowerCase();
    if (HEADING_KEYWORDS.has(lower) && /^[A-Z]/.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Promote standalone lines that look like headings to proper markdown headings.
 */
export function promoteOrphanHeadings(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const prevLine = i > 0 ? lines[i - 1] : '';
    const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
    const isStandalone = prevLine?.trim() === '' && nextLine?.trim() === '';
    const isPrecededByBlank = prevLine?.trim() === '';

    if ((isStandalone || isPrecededByBlank) && isLikelyHeadingLine(line)) {
      const trimmed = line.trim();
      const isExample = /^example:\s/i.test(trimmed);
      const prefix = isExample ? '### ' : '## ';
      result.push(prefix + trimmed);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}
