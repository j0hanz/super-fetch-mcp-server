import { FRONTMATTER_DELIMITER, joinLines } from '../../config/formatting.js';
import type { MetadataBlock } from '../../config/types/content.js';

const YAML_SPECIAL_CHARS = /[:[\]{}"\r\t'|>&*!?,#]|\n/;
const YAML_NUMERIC = /^[\d.]+$/;
const YAML_RESERVED_WORDS = /^(true|false|null|yes|no|on|off)$/i;

const ESCAPE_PATTERNS = {
  backslash: /\\/g,
  quote: /"/g,
  newline: /\n/g,
  tab: /\t/g,
};

const YAML_QUOTE_CHECKS: readonly ((input: string) => boolean)[] = [
  (input) => YAML_SPECIAL_CHARS.test(input),
  (input) => input.startsWith(' ') || input.endsWith(' '),
  (input) => input === '',
  (input) => YAML_NUMERIC.test(input),
  (input) => YAML_RESERVED_WORDS.test(input),
];

function needsYamlQuotes(value: string): boolean {
  return YAML_QUOTE_CHECKS.some((check) => check(value));
}

function escapeYamlValue(value: string): string {
  if (!needsYamlQuotes(value)) {
    return value;
  }

  const escaped = value
    .replace(ESCAPE_PATTERNS.backslash, '\\\\')
    .replace(ESCAPE_PATTERNS.quote, '\\"')
    .replace(ESCAPE_PATTERNS.newline, '\\n')
    .replace(ESCAPE_PATTERNS.tab, '\\t');

  return `"${escaped}"`;
}

function appendFrontmatterField(
  lines: string[],
  key: string,
  value: string | undefined
): void {
  if (!value) return;
  lines.push(`${key}: ${escapeYamlValue(value)}`);
}

export function buildFrontmatter(metadata?: MetadataBlock): string {
  if (!metadata) return '';
  const lines: string[] = [FRONTMATTER_DELIMITER];

  appendFrontmatterField(lines, 'title', metadata.title);
  appendFrontmatterField(lines, 'source', metadata.url);

  lines.push(FRONTMATTER_DELIMITER);
  return joinLines(lines);
}
