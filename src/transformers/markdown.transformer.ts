import TurndownService from 'turndown';

import type { MetadataBlock } from '../config/types.js';

import { detectLanguage } from '../utils/language-detector.js';

/**
 * Noise line patterns that should be removed from markdown output.
 * These patterns commonly appear as standalone lines from HTML conversion.
 */
const NOISE_LINE_PATTERNS: readonly RegExp[] = [
  // Single letters or panel labels (common in code examples)
  /^[A-Z]$/,
  /^Panel\s+[A-Z]$/i,

  // Empty structural elements that survive HTML->Markdown conversion
  /^[•·→←↑↓►▼▲◄▶◀■□●○★☆✓✗✔✘×]+$/,
  /^[,;:\-–—]+$/,
  /^\[\d+\]$/,
  /^\(\d+\)$/,
] as const;

/** Pattern to match triple or more consecutive newlines */
const MULTIPLE_NEWLINES = /\n{3,}/g;

/**
 * Determines if a line is noise that should be removed from markdown.
 * Preserves lines starting with markdown syntax (headings, lists, code, etc.)
 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();

  // Empty lines are preserved
  if (!trimmed) return false;

  // Preserve lines with markdown syntax
  const markdownPrefixes = ['#', '-', '*', '`', '>', '|'];
  if (markdownPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return false;
  }

  // Check against noise patterns
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Fence marker for code blocks */
const CODE_FENCE = '```';

/**
 * Post-processes markdown content to remove noise lines.
 * Preserves content inside code blocks.
 */
function cleanMarkdownContent(markdown: string): string {
  const lines = markdown.split('\n');
  const cleanedLines: string[] = [];
  let insideCodeBlock = false;

  for (const line of lines) {
    // Track code block boundaries
    if (line.trim().startsWith(CODE_FENCE)) {
      insideCodeBlock = !insideCodeBlock;
      cleanedLines.push(line);
      continue;
    }

    // Preserve all content inside code blocks
    if (insideCodeBlock) {
      cleanedLines.push(line);
      continue;
    }

    // Filter noise lines outside code blocks
    if (!isNoiseLine(line)) {
      cleanedLines.push(line);
    }
  }

  return cleanedLines.join('\n');
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  bulletListMarker: '-',
});

// Remove noise elements
turndown.addRule('removeNoise', {
  filter: ['script', 'style', 'noscript', 'nav', 'footer', 'aside', 'iframe'],
  replacement: () => '',
});

// Enhanced code block handling with language detection
turndown.addRule('fencedCodeBlockWithLanguage', {
  filter: (node, options) => {
    return (
      options.codeBlockStyle === 'fenced' &&
      node.nodeName === 'PRE' &&
      node.firstChild !== null &&
      node.firstChild.nodeName === 'CODE'
    );
  },
  replacement: (_content, node) => {
    const codeNode = node.firstChild as HTMLElement;
    const code = codeNode.textContent || '';

    // Try to get language from class
    const className = codeNode.getAttribute('class') ?? '';
    const dataLang = codeNode.getAttribute('data-language') ?? '';

    const languageMatch =
      /language-(\w+)/.exec(className) ??
      /lang-(\w+)/.exec(className) ??
      /highlight-(\w+)/.exec(className) ??
      /^(\w+)$/.exec(dataLang);

    // Use detected language from class, or detect from content using utility
    const language = languageMatch?.[1] ?? detectLanguage(code) ?? '';

    return `\n\n\`\`\`${language}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`;
  },
});

// Pre-compiled regex patterns for YAML value escaping
const YAML_SPECIAL_CHARS = /[:[\]{}"\n\r\t'|>&*!?,#]/;
const YAML_NUMERIC = /^[\d.]+$/;
const YAML_RESERVED_WORDS = /^(true|false|null|yes|no|on|off)$/i;

// Escape sequence replacements
const ESCAPE_PATTERNS = {
  backslash: /\\/g,
  quote: /"/g,
  newline: /\n/g,
  tab: /\t/g,
} as const;

/**
 * Escapes a string value for safe YAML serialization.
 * Wraps in quotes when the value contains special characters.
 */
function escapeYamlValue(value: string): string {
  const requiresQuoting =
    YAML_SPECIAL_CHARS.test(value) ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value === '' ||
    YAML_NUMERIC.test(value) ||
    YAML_RESERVED_WORDS.test(value);

  if (!requiresQuoting) {
    return value;
  }

  const escaped = value
    .replace(ESCAPE_PATTERNS.backslash, '\\\\')
    .replace(ESCAPE_PATTERNS.quote, '\\"')
    .replace(ESCAPE_PATTERNS.newline, '\\n')
    .replace(ESCAPE_PATTERNS.tab, '\\t');

  return `"${escaped}"`;
}

/**
 * Creates YAML frontmatter from metadata block.
 */
function createFrontmatter(metadata: MetadataBlock): string {
  const lines = ['---'];

  if (metadata.title) {
    lines.push(`title: ${escapeYamlValue(metadata.title)}`);
  }
  if (metadata.url) {
    lines.push(`source: ${escapeYamlValue(metadata.url)}`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Converts HTML content to clean Markdown format.
 * Optionally prepends YAML frontmatter with metadata.
 *
 * @param html - Raw HTML content to convert
 * @param metadata - Optional metadata for YAML frontmatter
 * @returns Markdown string, optionally with frontmatter
 */
export function htmlToMarkdown(html: string, metadata?: MetadataBlock): string {
  const frontmatter = metadata ? createFrontmatter(metadata) : '';

  if (!html || typeof html !== 'string') {
    return frontmatter ? `${frontmatter}\n\n` : '';
  }

  try {
    let content = turndown.turndown(html);
    content = content.replace(MULTIPLE_NEWLINES, '\n\n').trim();
    content = cleanMarkdownContent(content);
    content = content.replace(MULTIPLE_NEWLINES, '\n\n').trim();

    return frontmatter ? `${frontmatter}\n\n${content}` : content;
  } catch {
    return frontmatter ? `${frontmatter}\n\n` : '';
  }
}
