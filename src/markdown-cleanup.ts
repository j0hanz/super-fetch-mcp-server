import { config } from './config.js';
import type { MetadataBlock } from './transform-types.js';

const MAX_LINE_LENGTH = 80;

const REGEX = {
  HEADING_MARKER: /^#{1,6}\s/m,
  HEADING_STRICT: /^#{1,6}\s+/m,
  EMPTY_HEADING: /^#{1,6}[ \t\u00A0]*$\r?\n?/gm,

  FENCE_START: /^\s*(`{3,}|~{3,})/,

  LIST_MARKER: /^(?:[-*+])\s/m,
  TOC_LINK: /^- \[[^\]]+\]\(#[^)]+\)\s*$/,
  TOC_HEADING: /^(?:#{1,6}\s+)?(?:table of contents|contents)\s*$/i,

  HTML_DOC_START: /^(<!doctype|<html)/i,
  ZERO_WIDTH_ANCHOR: /\[(?:\s|\u200B)*\]\(#[^)]*\)[ \t]*/g,
  SKIP_LINKS: /^\[Skip to (?:main )?(?:content|navigation)\]\(#[^)]*\)\s*$/gim,
  SKIP_LINK_SIMPLE: /^\[Skip link\]\(#[^)]*\)\s*$/gim,
  HELPFUL_PROMPT: /^Was this page helpful\??\s*$/gim,

  CONCATENATED_PROPS:
    /([a-z_][a-z0-9_]{0,30}\??:\s+)([\u0022\u201C][^\u0022\u201C\u201D]*[\u0022\u201D])([a-z_][a-z0-9_]{0,30}\??:)/g,

  DOUBLE_NEWLINE_REDUCER: /\n{3,}/g,

  SOURCE_KEY: /^source:\s/im,
} as const;

function getLineEnding(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function splitLinesLf(content: string): string[] {
  return content.split(/\r?\n/);
}

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

const SPECIAL_PREFIXES =
  /^(?:example|note|tip|warning|important|caution):\s+\S/i;

interface Segment {
  content: string;
  isFence: boolean;
}

interface FrontmatterData {
  fence: string;
  lines: string[];
  endIndex: number;
  lineEnding: '\n' | '\r\n';
}

function splitByFences(content: string): Segment[] {
  const lines = splitLinesLf(content);
  const segments: Segment[] = [];

  let buffer: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  const flush = (isFenceSegment: boolean): void => {
    if (buffer.length === 0) return;
    segments.push({ content: buffer.join('\n'), isFence: isFenceSegment });
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (inFence) {
      buffer.push(line);

      const isClosure =
        trimmed.startsWith(fenceMarker) &&
        trimmed.slice(fenceMarker.length).trim() === '';

      if (isClosure) {
        flush(true);
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    const match = REGEX.FENCE_START.exec(line);
    if (match) {
      flush(false);
      inFence = true;
      fenceMarker = match[1] ?? '```';
      buffer.push(line);
      continue;
    }

    buffer.push(line);
  }

  flush(inFence);
  return segments;
}

const HeadingHeuristics = {
  isTooLong: (line: string): boolean => line.length > MAX_LINE_LENGTH,
  isSpecialPrefix: (line: string): boolean => SPECIAL_PREFIXES.test(line),

  isTitleCaseOrKeyword: (trimmed: string): boolean => {
    const words = trimmed.split(/\s+/);

    if (words.length === 1) {
      return (
        /^[A-Z]/.test(trimmed) && HEADING_KEYWORDS.has(trimmed.toLowerCase())
      );
    }

    if (words.length >= 2 && words.length <= 6) {
      const allTitleCase = words.every(
        (w) =>
          /^[A-Z][a-z]*$/.test(w) || /^(?:and|or|the|of|in|for|to|a)$/i.test(w)
      );
      if (!allTitleCase) return false;

      const capitalizedCount = words.filter((w) =>
        /^[A-Z][a-z]*$/.test(w)
      ).length;
      return capitalizedCount >= 2;
    }

    return false;
  },
};

function getHeadingPrefix(trimmed: string): string | null {
  if (HeadingHeuristics.isTooLong(trimmed)) return null;

  if (
    REGEX.HEADING_MARKER.test(trimmed) ||
    REGEX.LIST_MARKER.test(trimmed) ||
    /^\d+\.\s/.test(trimmed) ||
    /^\[.*\]\(.*\)$/.test(trimmed)
  ) {
    return null;
  }

  if (HeadingHeuristics.isSpecialPrefix(trimmed)) {
    return /^example:\s/i.test(trimmed) ? '### ' : '## ';
  }

  if (/[.!?]$/.test(trimmed)) return null;

  return HeadingHeuristics.isTitleCaseOrKeyword(trimmed) ? '## ' : null;
}

function hasFollowingContent(lines: string[], startIndex: number): boolean {
  return lines.slice(startIndex + 1).some((l) => l.trim() !== '');
}

function isPromotableLine(
  lines: string[],
  index: number,
  trimmed: string
): string | null {
  const prevLine = index > 0 ? (lines[index - 1] ?? '') : '';
  const isOrphan = index === 0 || prevLine.trim() === '';
  if (!isOrphan) return null;

  const prefix = getHeadingPrefix(trimmed);
  if (!prefix) return null;

  const isTitleCaseOnly =
    prefix === '## ' &&
    !HeadingHeuristics.isSpecialPrefix(trimmed) &&
    trimmed.split(/\s+/).length >= 2;

  if (isTitleCaseOnly && !hasFollowingContent(lines, index)) return null;

  return prefix;
}

function promoteOrphanHeadings(segmentText: string): string {
  if (!segmentText) return '';
  const lines = splitLinesLf(segmentText);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed) continue;

    const prefix = isPromotableLine(lines, i, trimmed);
    if (prefix) lines[i] = `${prefix}${trimmed}`;
  }

  return lines.join('\n');
}

function removeEmptyHeadings(text: string): string {
  return text.replace(REGEX.EMPTY_HEADING, '');
}

function fixAndSpaceHeadings(text: string): string {
  let current = text;

  current = current.replace(/(^#{1,6}\s[^\n]*)\n([^\n])/gm, '$1\n\n$2');
  current = current.replace(/(^#{1,6}\s+\w+)```/gm, '$1\n\n```');
  current = current.replace(/(^#{1,6}\s+\w*[A-Z])([A-Z][a-z])/gm, '$1\n\n$2');

  return current;
}

function removeSkipLinks(text: string): string {
  return text
    .replace(REGEX.ZERO_WIDTH_ANCHOR, '')
    .replace(REGEX.SKIP_LINKS, '')
    .replace(REGEX.SKIP_LINK_SIMPLE, '');
}

function hasTocBlock(lines: string[], headingIndex: number): boolean {
  const lookaheadMax = Math.min(lines.length, headingIndex + 8);

  for (let i = headingIndex + 1; i < lookaheadMax; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed) continue;
    return REGEX.TOC_LINK.test(line);
  }

  return false;
}

function skipTocLines(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (REGEX.TOC_LINK.test(line)) continue;

    return i;
  }

  return lines.length;
}

function removeToc(text: string): string {
  const lines = splitLinesLf(text);
  const out: string[] = [];

  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (REGEX.TOC_HEADING.test(trimmed) && hasTocBlock(lines, i)) {
      i = skipTocLines(lines, i + 1);
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n');
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\]\(([^)]+)\)\[/g, ']($1)\n\n[')
    .replace(REGEX.HELPFUL_PROMPT, '')
    .replace(/\]\([^)]+\)(?=[A-Za-z0-9])/g, '$& ')
    .replace(/`[^`]+`(?=[A-Za-z0-9])/g, '$& ')
    .replace(/(`[^`]+`)\s*\\-\s*/g, '$1 - ')
    .replace(/\\([[\].])/g, '$1')
    .replace(/\]\([^)]*%5[Ff][^)]*\)/g, (m) => m.replace(/%5[Ff]/g, '_'))
    .replace(/^((?![-*+] |\d+\. |[ \t]).+)\n([-*+] )/gm, '$1\n\n$2')
    .replace(/^((?![-*+] |\d+\. |[ \t]).+)\n(\d+\. )/gm, '$1\n\n$2')
    .replace(REGEX.DOUBLE_NEWLINE_REDUCER, '\n\n');
}

function fixProperties(text: string): string {
  let current = text;

  for (let i = 0; i < 3; i++) {
    const next = current.replace(REGEX.CONCATENATED_PROPS, '$1$2\n\n$3');
    if (next === current) break;
    current = next;
  }

  return current;
}

function removeTypeDocComments(text: string): string {
  const pattern = /(`+)(?:(?!\1)[\s\S])*?\1|\s?\/\\?\*[\s\S]*?\\?\*\//g;

  return text.replace(pattern, (match) => (match.startsWith('`') ? match : ''));
}

type CleanupStep = (text: string) => string;

const CLEANUP_PIPELINE: CleanupStep[] = [
  (text) =>
    config.markdownCleanup.promoteOrphanHeadings
      ? promoteOrphanHeadings(text)
      : text,
  fixAndSpaceHeadings,
  (text) =>
    config.markdownCleanup.removeTypeDocComments
      ? removeTypeDocComments(text)
      : text,
  (text) =>
    config.markdownCleanup.removeSkipLinks ? removeSkipLinks(text) : text,
  (text) => (config.markdownCleanup.removeTocBlocks ? removeToc(text) : text),
  removeEmptyHeadings,
  normalizeSpacing,
  fixProperties,
];

const Frontmatter = {
  detect(content: string): FrontmatterData | null {
    let lineEnding: '\n' | '\r\n' | null = null;

    if (content.startsWith('---\r\n')) {
      lineEnding = '\r\n';
    } else if (content.startsWith('---\n')) {
      lineEnding = '\n';
    }

    if (!lineEnding) return null;

    const fence = `---${lineEnding}`;
    const closeFenceIndex = content.indexOf(fence, fence.length);
    if (closeFenceIndex === -1) return null;

    return {
      fence,
      lines: content.slice(0, closeFenceIndex).split(lineEnding),
      endIndex: closeFenceIndex + fence.length,
      lineEnding,
    };
  },

  parseEntry(line: string): { key: string; value: string } | null {
    const trimmed = line.trim();
    const idx = trimmed.indexOf(':');
    if (!trimmed || idx <= 0) return null;

    return {
      key: trimmed.slice(0, idx).trim().toLowerCase(),
      value: trimmed.slice(idx + 1).trim(),
    };
  },

  stripQuotes(val: string): string {
    const first = val.charAt(0);
    const last = val.charAt(val.length - 1);

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return val.slice(1, -1).trim();
    }

    return val;
  },
};

function applyCleanupPipeline(text: string): string {
  return CLEANUP_PIPELINE.reduce((acc, step) => step(acc), text);
}

export function cleanupMarkdownArtifacts(content: string): string {
  if (!content) return '';

  const segments = splitByFences(content);

  const processed = segments.map((seg) =>
    seg.isFence ? seg.content : applyCleanupPipeline(seg.content)
  );

  return processed.join('\n').trim();
}

export function extractTitleFromRawMarkdown(
  content: string
): string | undefined {
  const fmTitle = extractTitleFromFrontmatter(content);
  if (fmTitle) return fmTitle;

  return extractTitleFromBody(content);
}

function extractTitleFromFrontmatter(content: string): string | undefined {
  const fm = Frontmatter.detect(content);
  if (!fm) return undefined;

  for (const line of fm.lines) {
    const entry = Frontmatter.parseEntry(line);
    if (!entry) continue;

    if (entry.key === 'title' || entry.key === 'name') {
      const cleaned = Frontmatter.stripQuotes(entry.value);
      if (cleaned) return cleaned;
    }
  }

  return undefined;
}

function extractTitleFromBody(content: string): string | undefined {
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (REGEX.HEADING_STRICT.test(trimmed)) {
      return trimmed.replace(REGEX.HEADING_MARKER, '').trim() || undefined;
    }

    return undefined;
  }

  return undefined;
}

function hasSourceKey(text: string): boolean {
  return REGEX.SOURCE_KEY.test(text);
}

function escapeFrontmatterString(value: string): string {
  return value.replace(/"/g, '\\"');
}

function injectSourceIntoBody(content: string, url: string): string {
  const lineEnding = getLineEnding(content);
  const lines = content.split(lineEnding);

  const firstNonEmptyIndex = lines.findIndex((l) => l.trim().length > 0);
  const firstNonEmptyLine = lines[firstNonEmptyIndex] ?? '';

  if (
    firstNonEmptyIndex !== -1 &&
    REGEX.HEADING_MARKER.test(firstNonEmptyLine.trim())
  ) {
    lines.splice(firstNonEmptyIndex + 1, 0, '', `Source: ${url}`, '');
    return lines.join(lineEnding);
  }

  lines.unshift(`Source: ${url}`, '');
  return lines.join(lineEnding);
}

function injectSourceIntoFrontmatter(
  content: string,
  fm: FrontmatterData,
  url: string
): string {
  const closeFenceIndex = fm.endIndex - fm.fence.length;
  const fmBody = content.slice(fm.fence.length, closeFenceIndex);

  if (hasSourceKey(fmBody)) return content;

  const escapedUrl = escapeFrontmatterString(url);
  const injection = `source: "${escapedUrl}"${fm.lineEnding}`;

  return (
    content.slice(0, closeFenceIndex) +
    injection +
    content.slice(closeFenceIndex)
  );
}

function createFrontmatterWithSource(content: string, url: string): string {
  const lineEnding = getLineEnding(content);
  const escapedUrl = escapeFrontmatterString(url);

  return `---${lineEnding}source: "${escapedUrl}"${lineEnding}---${lineEnding}${lineEnding}${content}`;
}

export function addSourceToMarkdown(content: string, url: string): string {
  const fm = Frontmatter.detect(content);
  const useMarkdownFormat = config.transform.metadataFormat === 'markdown';

  if (useMarkdownFormat && !fm) {
    if (hasSourceKey(content)) return content;
    return injectSourceIntoBody(content, url);
  }

  if (!fm) return createFrontmatterWithSource(content, url);

  return injectSourceIntoFrontmatter(content, fm, url);
}

function countCommonTags(content: string, limit: number): number {
  if (limit <= 0) return 0;

  const regex = /<(html|head|body|div|span|script|style|meta|link)\b/gi;

  let count = 0;
  while (regex.exec(content)) {
    count += 1;
    if (count > limit) break;
  }

  return count;
}

export function isRawTextContent(content: string): boolean {
  const trimmed = content.trim();
  if (REGEX.HTML_DOC_START.test(trimmed)) return false;

  if (Frontmatter.detect(trimmed) !== null) return true;

  const tagCount = countCommonTags(content, 5);
  if (tagCount > 5) return false;

  return (
    REGEX.HEADING_MARKER.test(content) ||
    REGEX.LIST_MARKER.test(content) ||
    content.includes('```')
  );
}

function formatFetchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());

  return `${dd}-${mm}-${yyyy}`;
}

export function buildMetadataFooter(
  metadata?: MetadataBlock,
  fallbackUrl?: string
): string {
  if (!metadata) return '';

  const lines: string[] = ['---', ''];
  const url = metadata.url || fallbackUrl;

  const parts: string[] = [];
  if (metadata.title) parts.push(`_${metadata.title}_`);
  if (metadata.author) parts.push(`_${metadata.author}_`);
  if (url) parts.push(`[_Original Source_](${url})`);

  if (metadata.fetchedAt) {
    parts.push(`_${formatFetchedAt(metadata.fetchedAt)}_`);
  }

  if (parts.length > 0) lines.push(` ${parts.join(' | ')}`);
  if (metadata.description) lines.push(` <sub>${metadata.description}</sub>`);

  return lines.join('\n');
}
