/**
 * Language detection for code blocks.
 * Detects programming languages from code content and HTML attributes.
 */

/**
 * Check if character is a word character (alphanumeric or underscore).
 */
function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === '_'
  );
}

/**
 * Check if source contains the given word as a standalone word (not part of another word).
 */
function containsWord(source: string, word: string): boolean {
  let startIndex = source.indexOf(word);
  while (startIndex !== -1) {
    const before = startIndex === 0 ? '' : source[startIndex - 1];
    const afterIndex = startIndex + word.length;
    const after = afterIndex >= source.length ? '' : source[afterIndex];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    startIndex = source.indexOf(word, startIndex + word.length);
  }
  return false;
}

/**
 * Split content into lines.
 */
function splitLines(content: string): string[] {
  return content.split('\n');
}

/**
 * Extract language from class name (e.g., "language-typescript", "lang-js", "hljs javascript").
 */
function extractLanguageFromClassName(className: string): string | undefined {
  const tokens = className.match(/\S+/g);
  if (!tokens) return undefined;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('language-')) return token.slice('language-'.length);
    if (lower.startsWith('lang-')) return token.slice('lang-'.length);
    if (lower.startsWith('highlight-')) {
      return token.slice('highlight-'.length);
    }
  }

  if (tokens.includes('hljs')) {
    const langClass = tokens.find(
      (t) => t !== 'hljs' && !t.startsWith('hljs-')
    );
    if (langClass) return langClass;
  }

  return undefined;
}

/**
 * Resolve language from data-language attribute.
 */
function resolveLanguageFromDataAttribute(
  dataLang: string
): string | undefined {
  const trimmed = dataLang.trim();
  if (!trimmed) return undefined;
  for (const char of trimmed) {
    if (!isWordChar(char)) return undefined;
  }
  return trimmed;
}

/**
 * Check if code contains JSX-style tags (tags starting with uppercase like <Component>).
 */
function containsJsxTag(code: string): boolean {
  for (let index = 0; index < code.length - 1; index += 1) {
    if (code[index] !== '<') continue;
    const next = code[index + 1];
    if (!next) continue;
    if (next >= 'A' && next <= 'Z') return true;
  }
  return false;
}

/**
 * Pattern definition for language detection.
 */
interface LanguagePattern {
  keywords?: readonly string[];
  wordBoundary?: readonly string[];
  regex?: RegExp;
  startsWith?: readonly string[];
  custom?: (code: string, lower: string) => boolean;
}

// Bash detection constants
const BASH_COMMANDS = ['sudo', 'chmod', 'mkdir', 'cd', 'ls', 'cat', 'echo'];
const BASH_PKG_MANAGERS = [
  'npm',
  'yarn',
  'pnpm',
  'npx',
  'brew',
  'apt',
  'pip',
  'cargo',
  'go',
];
const BASH_VERBS = ['install', 'add', 'run', 'build', 'start'];

function isShellPrefix(line: string): boolean {
  return (
    line.startsWith('#!') || line.startsWith('$ ') || line.startsWith('# ')
  );
}

function matchesBashCommand(line: string): boolean {
  return BASH_COMMANDS.some(
    (cmd) => line === cmd || line.startsWith(`${cmd} `)
  );
}

function matchesPackageManagerVerb(line: string): boolean {
  for (const mgr of BASH_PKG_MANAGERS) {
    if (!line.startsWith(`${mgr} `)) continue;
    const rest = line.slice(mgr.length + 1);
    if (BASH_VERBS.some((v) => rest === v || rest.startsWith(`${v} `))) {
      return true;
    }
  }
  return false;
}

function detectBashIndicators(code: string): boolean {
  for (const line of splitLines(code)) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (
      isShellPrefix(trimmed) ||
      matchesBashCommand(trimmed) ||
      matchesPackageManagerVerb(trimmed)
    ) {
      return true;
    }
  }
  return false;
}

function detectCssStructure(code: string): boolean {
  for (const line of splitLines(code)) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    const isSelector =
      (trimmed.startsWith('.') || trimmed.startsWith('#')) &&
      trimmed.includes('{');
    const isProperty = trimmed.includes(':') && trimmed.includes(';');
    if (isSelector || isProperty) return true;
  }
  return false;
}

function detectYamlStructure(code: string): boolean {
  for (const line of splitLines(code)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const after = trimmed[colonIdx + 1];
    if (after === ' ' || after === '\t') return true;
  }
  return false;
}

/**
 * Language detection patterns in priority order.
 */
const LANGUAGE_PATTERNS: readonly {
  language: string;
  pattern: LanguagePattern;
}[] = [
  {
    language: 'jsx',
    pattern: {
      keywords: ['classname=', 'jsx:', "from 'react'", 'from "react"'],
      custom: (code) => containsJsxTag(code),
    },
  },
  {
    language: 'typescript',
    pattern: {
      wordBoundary: ['interface', 'type'],
      custom: (_, lower) =>
        [
          ': string',
          ':string',
          ': number',
          ':number',
          ': boolean',
          ':boolean',
          ': void',
          ':void',
          ': any',
          ':any',
          ': unknown',
          ':unknown',
          ': never',
          ':never',
        ].some((hint) => lower.includes(hint)),
    },
  },
  {
    language: 'rust',
    pattern: {
      regex: /\b(?:fn|impl|struct|enum)\b/,
      keywords: ['let mut'],
      custom: (_, lower) => lower.includes('use ') && lower.includes('::'),
    },
  },
  {
    language: 'javascript',
    pattern: {
      regex: /\b(?:const|let|var|function|class|async|await|export|import)\b/,
    },
  },
  {
    language: 'python',
    pattern: {
      regex: /\b(?:def|class|import|from)\b/,
      keywords: ['print(', '__name__'],
    },
  },
  {
    language: 'bash',
    pattern: {
      custom: (code) => detectBashIndicators(code),
    },
  },
  {
    language: 'css',
    pattern: {
      regex: /@media|@import|@keyframes/,
      custom: (code) => detectCssStructure(code),
    },
  },
  {
    language: 'html',
    pattern: {
      keywords: [
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
      ],
    },
  },
  {
    language: 'json',
    pattern: {
      startsWith: ['{', '['],
    },
  },
  {
    language: 'yaml',
    pattern: {
      custom: (code) => detectYamlStructure(code),
    },
  },
  {
    language: 'sql',
    pattern: {
      wordBoundary: [
        'select',
        'insert',
        'update',
        'delete',
        'create',
        'alter',
        'drop',
      ],
    },
  },
  {
    language: 'go',
    pattern: {
      wordBoundary: ['package', 'func'],
      keywords: ['import "'],
    },
  },
];

function matchesLanguagePattern(
  code: string,
  lower: string,
  pattern: LanguagePattern
): boolean {
  if (pattern.keywords?.some((kw) => lower.includes(kw))) return true;
  if (pattern.wordBoundary?.some((w) => containsWord(lower, w))) return true;
  if (pattern.regex?.test(lower)) return true;
  if (pattern.startsWith) {
    const trimmed = code.trimStart();
    if (pattern.startsWith.some((prefix) => trimmed.startsWith(prefix)))
      return true;
  }
  if (pattern.custom?.(code, lower)) return true;
  return false;
}

/**
 * Detect programming language from code content using heuristics.
 */
export function detectLanguageFromCode(code: string): string | undefined {
  const lower = code.toLowerCase();
  for (const { language, pattern } of LANGUAGE_PATTERNS) {
    if (matchesLanguagePattern(code, lower, pattern)) return language;
  }
  return undefined;
}

/**
 * Resolve language from HTML attributes (class name and data-language).
 */
export function resolveLanguageFromAttributes(
  className: string,
  dataLang: string
): string | undefined {
  const classMatch = extractLanguageFromClassName(className);
  return classMatch ?? resolveLanguageFromDataAttribute(dataLang);
}
