interface LanguagePattern {
  keywords?: readonly string[];
  wordBoundary?: readonly string[];
  regex?: RegExp;
  startsWith?: readonly string[];
  custom?: (sample: CodeSample) => boolean;
}

interface CodeSample {
  code: string;
  lower: string;
  lines: readonly string[];
  trimmedStart: string;
}

type SamplePredicate = (sample: CodeSample) => boolean;

const BASH_COMMANDS = [
  'sudo',
  'chmod',
  'mkdir',
  'cd',
  'ls',
  'cat',
  'echo',
] as const;

const BASH_PACKAGE_MANAGERS = [
  'npm',
  'yarn',
  'pnpm',
  'npx',
  'brew',
  'apt',
  'pip',
  'cargo',
  'go',
] as const;

const BASH_VERBS = ['install', 'add', 'run', 'build', 'start'] as const;

const TYPESCRIPT_HINTS = [
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
] as const;

function createCodeSample(code: string): CodeSample {
  return {
    code,
    lower: code.toLowerCase(),
    lines: code.split(/\r?\n/),
    trimmedStart: code.trimStart(),
  };
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resetStatefulRegex(regex: RegExp): void {
  if (regex.global || regex.sticky) regex.lastIndex = 0;
}

function safeTest(regex: RegExp, input: string): boolean {
  resetStatefulRegex(regex);
  return regex.test(input);
}

function compileWordBoundaryRegex(word: string): RegExp {
  return new RegExp(`\\b${escapeRegExpLiteral(word)}\\b`);
}

function containsJsxTag(code: string): boolean {
  for (let i = 0; i < code.length - 1; i += 1) {
    if (code[i] !== '<') continue;
    const next = code[i + 1];
    if (next && next >= 'A' && next <= 'Z') return true;
  }
  return false;
}

function isShellPrefix(line: string): boolean {
  return (
    line.startsWith('#!') || line.startsWith('$ ') || line.startsWith('# ')
  );
}

function matchesCommand(line: string): boolean {
  return BASH_COMMANDS.some(
    (cmd) => line === cmd || line.startsWith(`${cmd} `)
  );
}

function matchesPackageManagerVerb(line: string): boolean {
  for (const mgr of BASH_PACKAGE_MANAGERS) {
    if (!line.startsWith(`${mgr} `)) continue;
    const rest = line.slice(mgr.length + 1);
    if (BASH_VERBS.some((verb) => rest === verb || rest.startsWith(`${verb} `)))
      return true;
  }
  return false;
}

function detectBashIndicators(lines: readonly string[]): boolean {
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (isShellPrefix(trimmed)) return true;
    if (matchesCommand(trimmed)) return true;
    if (matchesPackageManagerVerb(trimmed)) return true;
  }
  return false;
}

function detectCssStructure(lines: readonly string[]): boolean {
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    const hasSelector =
      (trimmed.startsWith('.') || trimmed.startsWith('#')) &&
      trimmed.includes('{');

    if (hasSelector || (trimmed.includes(':') && trimmed.includes(';')))
      return true;
  }
  return false;
}

function detectYamlStructure(lines: readonly string[]): boolean {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const after = trimmed[colonIdx + 1];
    if (after === ' ' || after === '\t') return true;
  }
  return false;
}

const LANGUAGE_PATTERNS: readonly {
  language: string;
  weight: number;
  pattern: LanguagePattern;
}[] = [
  {
    language: 'jsx',
    weight: 22,
    pattern: {
      keywords: ['classname=', 'jsx:', "from 'react'", 'from "react"'],
      custom: (sample) => containsJsxTag(sample.code),
    },
  },
  {
    language: 'typescript',
    weight: 20,
    pattern: {
      wordBoundary: ['interface', 'type'],
      custom: (sample) =>
        TYPESCRIPT_HINTS.some((hint) => sample.lower.includes(hint)),
    },
  },
  {
    language: 'rust',
    weight: 25,
    pattern: {
      regex: /\b(?:fn|impl|struct|enum)\b/,
      keywords: ['let mut'],
      custom: (sample) =>
        sample.lower.includes('use ') && sample.lower.includes('::'),
    },
  },
  {
    language: 'javascript',
    weight: 12,
    pattern: {
      regex: /\b(?:const|let|var|function|class|async|await|export|import)\b/,
    },
  },
  {
    language: 'python',
    weight: 18,
    pattern: {
      regex: /\b(?:def|class|import|from)\b/,
      keywords: ['print(', '__name__'],
    },
  },
  {
    language: 'bash',
    weight: 15,
    pattern: {
      custom: (sample) => detectBashIndicators(sample.lines),
    },
  },
  {
    language: 'css',
    weight: 18,
    pattern: {
      regex: /@media|@import|@keyframes/,
      custom: (sample) => detectCssStructure(sample.lines),
    },
  },
  {
    language: 'html',
    weight: 12,
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
    weight: 10,
    pattern: {
      startsWith: ['{', '['],
    },
  },
  {
    language: 'yaml',
    weight: 15,
    pattern: {
      custom: (sample) => detectYamlStructure(sample.lines),
    },
  },
  {
    language: 'sql',
    weight: 20,
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
    weight: 22,
    pattern: {
      wordBoundary: ['package', 'func'],
      keywords: ['import "'],
    },
  },
];

function includesAny(haystack: string, needles: readonly string[]): boolean {
  for (const needle of needles) {
    if (haystack.includes(needle)) return true;
  }
  return false;
}

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return true;
  }
  return false;
}

function matchesAnyRegex(value: string, regexes: readonly RegExp[]): boolean {
  for (const regex of regexes) {
    if (safeTest(regex, value)) return true;
  }
  return false;
}

function toLowercaseList(values?: readonly string[]): readonly string[] {
  if (!values || values.length === 0) return [];
  return values.map((value) => value.toLowerCase());
}

function compilePattern(pattern: LanguagePattern): SamplePredicate {
  const {
    keywords: rawKeywords,
    wordBoundary,
    startsWith,
    regex,
    custom,
  } = pattern;
  const keywords = toLowercaseList(rawKeywords);
  const boundaryRegexes = toLowercaseList(wordBoundary).map((w) =>
    compileWordBoundaryRegex(w)
  );
  const startsWithList = startsWith ?? [];

  const hasKeywords = keywords.length > 0;
  const hasBoundaries = boundaryRegexes.length > 0;
  const hasStartsWith = startsWithList.length > 0;
  const hasRegex = Boolean(regex);
  const hasCustom = Boolean(custom);

  return (sample: CodeSample): boolean => {
    if (hasKeywords && includesAny(sample.lower, keywords)) return true;
    if (hasBoundaries && matchesAnyRegex(sample.lower, boundaryRegexes))
      return true;
    if (hasRegex && regex && safeTest(regex, sample.lower)) return true;
    if (hasStartsWith && startsWithAny(sample.trimmedStart, startsWithList))
      return true;
    if (hasCustom && custom?.(sample)) return true;
    return false;
  };
}

const COMPILED_PATTERNS: readonly {
  language: string;
  weight: number;
  matches: SamplePredicate;
}[] = LANGUAGE_PATTERNS.map(({ language, weight, pattern }) => ({
  language,
  weight,
  matches: compilePattern(pattern),
}));

function extractLanguageFromClassName(className: string): string | undefined {
  const tokens = className.match(/\S+/g);
  if (!tokens) return undefined;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('language-')) return token.slice('language-'.length);
    if (lower.startsWith('lang-')) return token.slice('lang-'.length);
    if (lower.startsWith('highlight-')) return token.slice('highlight-'.length);
  }

  if (!tokens.includes('hljs')) return undefined;

  const langClass = tokens.find((t) => t !== 'hljs' && !t.startsWith('hljs-'));
  return langClass ?? undefined;
}

function resolveLanguageFromDataAttribute(
  dataLang: string
): string | undefined {
  const trimmed = dataLang.trim();
  if (!trimmed) return undefined;
  return /^\w+$/.test(trimmed) ? trimmed : undefined;
}

function resolveLanguage(
  className: string,
  dataLang: string
): string | undefined {
  return (
    extractLanguageFromClassName(className) ??
    resolveLanguageFromDataAttribute(dataLang)
  );
}

function detectLanguage(code: string): string | undefined {
  const sample = createCodeSample(code);
  const scores = new Map<string, number>();

  let bestLang: string | undefined;
  let bestScore = -1;

  for (const { language, weight, matches } of COMPILED_PATTERNS) {
    if (!matches(sample)) continue;

    const nextScore = (scores.get(language) ?? 0) + weight;
    scores.set(language, nextScore);

    if (nextScore > bestScore) {
      bestScore = nextScore;
      bestLang = language;
    }
  }

  return bestLang;
}

export function detectLanguageFromCode(code: string): string | undefined {
  if (!code || code.trim().length === 0) return undefined;
  return detectLanguage(code);
}

export function resolveLanguageFromAttributes(
  className: string,
  dataLang: string
): string | undefined {
  return resolveLanguage(className, dataLang);
}
