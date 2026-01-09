import { detectBash } from './code-language-bash.js';
import {
  containsJsxTag,
  containsWord,
  splitLines,
} from './code-language-parsing.js';

export interface CodeDetector {
  language: string;
  detect: (code: string) => boolean;
}

const TYPE_HINTS = [
  'string',
  'number',
  'boolean',
  'void',
  'any',
  'unknown',
  'never',
];

const HTML_TAGS = [
  '<!doctype',
  '<html',
  '<head',
  '<body',
  '<div',
  '<span',
  '<p',
  '<a',
  '<script',
  '<style',
];
const SQL_KEYWORDS = [
  'select',
  'insert',
  'update',
  'delete',
  'create',
  'alter',
  'drop',
];
const JS_WORD_REGEX =
  /\b(?:const|let|var|function|class|async|await|export|import)\b/;
const PYTHON_WORD_REGEX = /\b(?:def|class|import|from)\b/;
const RUST_WORD_REGEX = /\b(?:fn|impl|struct|enum)\b/;
const CSS_DIRECTIVE_REGEX = /@media|@import|@keyframes/;

export const CODE_DETECTORS: readonly CodeDetector[] = [
  { language: 'jsx', detect: detectJsx },
  { language: 'typescript', detect: detectTypescript },
  { language: 'rust', detect: detectRust },
  { language: 'javascript', detect: detectJavascript },
  { language: 'python', detect: detectPython },
  { language: 'bash', detect: detectBash },
  { language: 'css', detect: detectCss },
  { language: 'html', detect: detectHtml },
  { language: 'json', detect: detectJson },
  { language: 'yaml', detect: detectYaml },
  { language: 'sql', detect: detectSql },
  { language: 'go', detect: detectGo },
];

function detectJsx(code: string): boolean {
  const lower = code.toLowerCase();
  if (lower.includes('classname=')) return true;
  if (lower.includes('jsx:')) return true;
  if (lower.includes("from 'react'") || lower.includes('from "react"')) {
    return true;
  }
  return containsJsxTag(code);
}

function detectTypescript(code: string): boolean {
  const lower = code.toLowerCase();
  if (containsWord(lower, 'interface')) return true;
  if (containsWord(lower, 'type')) return true;
  return TYPE_HINTS.some(
    (hint) => lower.includes(`: ${hint}`) || lower.includes(`:${hint}`)
  );
}

function detectRust(code: string): boolean {
  const lower = code.toLowerCase();
  return (
    RUST_WORD_REGEX.test(lower) ||
    lower.includes('let mut') ||
    (lower.includes('use ') && lower.includes('::'))
  );
}

function detectJavascript(code: string): boolean {
  const lower = code.toLowerCase();
  return JS_WORD_REGEX.test(lower);
}

function detectPython(code: string): boolean {
  const lower = code.toLowerCase();
  return (
    PYTHON_WORD_REGEX.test(lower) ||
    lower.includes('print(') ||
    lower.includes('__name__')
  );
}

function detectCss(code: string): boolean {
  const lower = code.toLowerCase();
  if (CSS_DIRECTIVE_REGEX.test(lower)) return true;

  const lines = splitLines(code);
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (isCssSelectorLine(trimmed) || isCssPropertyLine(trimmed)) return true;
  }
  return false;
}

function detectHtml(code: string): boolean {
  const lower = code.toLowerCase();
  return HTML_TAGS.some((tag) => lower.includes(tag));
}

function detectJson(code: string): boolean {
  const trimmed = code.trimStart();
  if (!trimmed) return false;
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function detectYaml(code: string): boolean {
  const lines = splitLines(code);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) continue;
    const after = trimmed[colonIndex + 1];
    if (after === ' ' || after === '\t') return true;
  }
  return false;
}

function detectSql(code: string): boolean {
  const lower = code.toLowerCase();
  return SQL_KEYWORDS.some((keyword) => containsWord(lower, keyword));
}

function detectGo(code: string): boolean {
  const lower = code.toLowerCase();
  return (
    containsWord(lower, 'package') ||
    containsWord(lower, 'func') ||
    lower.includes('import "')
  );
}

function isCssSelectorLine(line: string): boolean {
  if (!line.startsWith('.') && !line.startsWith('#')) return false;
  return line.includes('{');
}

function isCssPropertyLine(line: string): boolean {
  return line.includes(':') && line.includes(';');
}
