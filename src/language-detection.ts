interface LanguagePattern {
  keywords?: readonly string[];
  wordBoundary?: readonly string[];
  regex?: RegExp;
  startsWith?: readonly string[];
  custom?: (code: string, lower: string, lines: string[]) => boolean;
}

interface CodeSample {
  code: string;
  lower: string;
  lines: string[];
  trimmedStart: string;
}

function createCodeSample(code: string): CodeSample {
  return {
    code,
    lower: code.toLowerCase(),
    lines: code.split('\n'),
    trimmedStart: code.trimStart(),
  };
}

type SamplePredicate = (sample: CodeSample) => boolean;

function escapeRegExpLiteral(value: string): string {
  // Escapes characters that have special meaning in a RegExp.
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeTest(regex: RegExp, input: string): boolean {
  // Guard against stateful RegExp flags (g/y) causing false negatives across calls.
  if (regex.global || regex.sticky) regex.lastIndex = 0;
  return regex.test(input);
}

function compileWordBoundaryRegex(word: string): RegExp {
  // Words are controlled, but escape defensively to avoid future footguns.
  return new RegExp(`\\b${escapeRegExpLiteral(word)}\\b`);
}

const Heuristics = {
  containsJsxTag(code: string): boolean {
    for (let i = 0; i < code.length - 1; i += 1) {
      if (code[i] !== '<') continue;
      const next = code[i + 1];
      if (!next) continue;
      if (next >= 'A' && next <= 'Z') return true;
    }
    return false;
  },

  bash: (() => {
    const commands = [
      'sudo',
      'chmod',
      'mkdir',
      'cd',
      'ls',
      'cat',
      'echo',
    ] as const;
    const pkgManagers = [
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
    const verbs = ['install', 'add', 'run', 'build', 'start'] as const;

    function isShellPrefix(line: string): boolean {
      return (
        line.startsWith('#!') || line.startsWith('$ ') || line.startsWith('# ')
      );
    }

    function matchesCommand(line: string): boolean {
      return commands.some((cmd) => line === cmd || line.startsWith(`${cmd} `));
    }

    function matchesPackageManagerVerb(line: string): boolean {
      for (const mgr of pkgManagers) {
        if (!line.startsWith(`${mgr} `)) continue;

        const rest = line.slice(mgr.length + 1);
        if (verbs.some((v) => rest === v || rest.startsWith(`${v} `)))
          return true;
      }
      return false;
    }

    function detectIndicators(lines: string[]): boolean {
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (
          trimmed &&
          (isShellPrefix(trimmed) ||
            matchesCommand(trimmed) ||
            matchesPackageManagerVerb(trimmed))
        ) {
          return true;
        }
      }
      return false;
    }

    return { detectIndicators } as const;
  })(),

  css: {
    detectStructure(lines: string[]): boolean {
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
    },
  },

  yaml: {
    detectStructure(lines: string[]): boolean {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0) continue;

        const after = trimmed[colonIdx + 1];
        if (after === ' ' || after === '\t') return true;
      }
      return false;
    },
  },
} as const;

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
      custom: (code) => Heuristics.containsJsxTag(code),
    },
  },
  {
    language: 'typescript',
    weight: 20,
    pattern: {
      wordBoundary: ['interface', 'type'],
      custom: (_code, lower) =>
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
    weight: 25,
    pattern: {
      regex: /\b(?:fn|impl|struct|enum)\b/,
      keywords: ['let mut'],
      custom: (_code, lower) => lower.includes('use ') && lower.includes('::'),
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
      custom: (_code, _lower, lines) => Heuristics.bash.detectIndicators(lines),
    },
  },
  {
    language: 'css',
    weight: 18,
    pattern: {
      regex: /@media|@import|@keyframes/,
      custom: (_code, _lower, lines) => Heuristics.css.detectStructure(lines),
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
      custom: (_code, _lower, lines) => Heuristics.yaml.detectStructure(lines),
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

function compilePattern(pattern: LanguagePattern): SamplePredicate {
  const {
    keywords: rawKeywords,
    wordBoundary,
    startsWith,
    regex,
    custom,
  } = pattern;

  const keywords = rawKeywords?.map((k) => k.toLowerCase());
  const boundaryRegexes = wordBoundary
    ?.map((w) => w.toLowerCase())
    .map((w) => compileWordBoundaryRegex(w));

  // Materialize optional arrays into stable references to avoid non-null assertions
  // while keeping the hot path fast.
  const keywordList = keywords ?? [];
  const boundaryList = boundaryRegexes ?? [];
  const startsWithList = startsWith ?? [];

  // Avoid repeatedly consulting optional fields inside the hot path.
  const hasKeywords = keywordList.length > 0;
  const hasBoundaries = boundaryList.length > 0;
  const hasStartsWith = startsWithList.length > 0;

  return (sample: CodeSample): boolean => {
    if (hasKeywords && keywordList.some((kw) => sample.lower.includes(kw)))
      return true;

    if (hasBoundaries && boundaryList.some((re) => safeTest(re, sample.lower)))
      return true;

    if (regex && safeTest(regex, sample.lower)) return true;

    if (
      hasStartsWith &&
      startsWithList.some((prefix) => sample.trimmedStart.startsWith(prefix))
    )
      return true;

    if (custom?.(sample.code, sample.lower, sample.lines)) return true;

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

class LanguageAttributeResolver {
  resolve(className: string, dataLang: string): string | undefined {
    const classMatch = this.extractFromClassName(className);
    return classMatch ?? this.resolveFromDataAttribute(dataLang);
  }

  private extractFromClassName(className: string): string | undefined {
    const tokens = className.match(/\S+/g);
    if (!tokens) return undefined;

    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower.startsWith('language-')) return token.slice('language-'.length);
      if (lower.startsWith('lang-')) return token.slice('lang-'.length);
      if (lower.startsWith('highlight-'))
        return token.slice('highlight-'.length);
    }

    if (tokens.includes('hljs')) {
      const langClass = tokens.find(
        (t) => t !== 'hljs' && !t.startsWith('hljs-')
      );
      if (langClass) return langClass;
    }

    return undefined;
  }

  private resolveFromDataAttribute(dataLang: string): string | undefined {
    const trimmed = dataLang.trim();
    if (!trimmed) return undefined;
    return /^\w+$/.test(trimmed) ? trimmed : undefined;
  }
}

const attributeResolver = new LanguageAttributeResolver();

class LanguageDetector {
  detect(code: string): string | undefined {
    const sample = createCodeSample(code);
    const scores = new Map<string, number>();

    for (const { language, weight, matches } of COMPILED_PATTERNS) {
      if (!matches(sample)) continue;

      const current = scores.get(language) ?? 0;
      scores.set(language, current + weight);
    }

    return pickHighestScore(scores);
  }
}

function pickHighestScore(scores: Map<string, number>): string | undefined {
  if (scores.size === 0) return undefined;

  let maxLang: string | undefined;
  let maxScore = 0;

  for (const [lang, score] of scores.entries()) {
    if (score > maxScore) {
      maxScore = score;
      maxLang = lang;
    }
  }

  return maxLang;
}

const detector = new LanguageDetector();

export function detectLanguageFromCode(code: string): string | undefined {
  if (!code || code.trim().length === 0) return undefined;
  return detector.detect(code);
}

export function resolveLanguageFromAttributes(
  className: string,
  dataLang: string
): string | undefined {
  return attributeResolver.resolve(className, dataLang);
}
