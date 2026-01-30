/**
 * Language detection for code blocks.
 * Detects programming languages from code content and HTML attributes.
 */

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

/* -------------------------------------------------------------------------------------------------
 * Word boundary matcher (cached)
 * ------------------------------------------------------------------------------------------------- */

class WordBoundaryMatcher {
  private readonly cache = new Map<string, RegExp>();

  containsWord(source: string, word: string): boolean {
    return this.getRegex(word).test(source);
  }

  private getRegex(word: string): RegExp {
    const cached = this.cache.get(word);
    if (cached) return cached;

    // Keep behavior: compile `\b${word}\b` without escaping (words are controlled by patterns).
    const compiled = new RegExp(`\\b${word}\\b`);
    this.cache.set(word, compiled);
    return compiled;
  }
}

const wordMatcher = new WordBoundaryMatcher();

/* -------------------------------------------------------------------------------------------------
 * Attribute-based language resolution
 * ------------------------------------------------------------------------------------------------- */

class LanguageAttributeResolver {
  resolve(className: string, dataLang: string): string | undefined {
    const classMatch = this.extractFromClassName(className);
    return classMatch ?? this.resolveFromDataAttribute(dataLang);
  }

  /**
   * Extract language from class name (e.g., "language-typescript", "lang-js", "hljs javascript").
   * Note: preserves current behavior by returning the sliced original token casing.
   */
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

  /**
   * Resolve language from data-language attribute.
   * Only allows word characters (alphanumeric + underscore).
   */
  private resolveFromDataAttribute(dataLang: string): string | undefined {
    const trimmed = dataLang.trim();
    if (!trimmed) return undefined;
    return /^\w+$/.test(trimmed) ? trimmed : undefined;
  }
}

const attributeResolver = new LanguageAttributeResolver();

/* -------------------------------------------------------------------------------------------------
 * Heuristics
 * ------------------------------------------------------------------------------------------------- */

const Heuristics = {
  containsJsxTag(code: string): boolean {
    // Preserve original behavior (scan for `<` followed by A-Z).
    for (let i = 0; i < code.length - 1; i += 1) {
      if (code[i] !== '<') continue;
      const next = code[i + 1];
      if (!next) continue;
      if (next >= 'A' && next <= 'Z') return true;
    }
    return false;
  },

  bash: {
    commands: ['sudo', 'chmod', 'mkdir', 'cd', 'ls', 'cat', 'echo'] as const,
    pkgManagers: [
      'npm',
      'yarn',
      'pnpm',
      'npx',
      'brew',
      'apt',
      'pip',
      'cargo',
      'go',
    ] as const,
    verbs: ['install', 'add', 'run', 'build', 'start'] as const,

    isShellPrefix(line: string): boolean {
      return (
        line.startsWith('#!') || line.startsWith('$ ') || line.startsWith('# ')
      );
    },

    matchesCommand(line: string): boolean {
      return Heuristics.bash.commands.some(
        (cmd) => line === cmd || line.startsWith(`${cmd} `)
      );
    },

    matchesPackageManagerVerb(line: string): boolean {
      for (const mgr of Heuristics.bash.pkgManagers) {
        if (!line.startsWith(`${mgr} `)) continue;

        const rest = line.slice(mgr.length + 1);
        if (
          Heuristics.bash.verbs.some(
            (v) => rest === v || rest.startsWith(`${v} `)
          )
        ) {
          return true;
        }
      }
      return false;
    },

    detectIndicators(lines: string[]): boolean {
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (
          trimmed &&
          (Heuristics.bash.isShellPrefix(trimmed) ||
            Heuristics.bash.matchesCommand(trimmed) ||
            Heuristics.bash.matchesPackageManagerVerb(trimmed))
        ) {
          return true;
        }
      }
      return false;
    },
  },

  css: {
    detectStructure(lines: string[]): boolean {
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (!trimmed) continue;

        const hasSelector =
          (trimmed.startsWith('.') || trimmed.startsWith('#')) &&
          trimmed.includes('{');

        if (hasSelector || (trimmed.includes(':') && trimmed.includes(';'))) {
          return true;
        }
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
        if (colonIdx > 0) {
          const after = trimmed[colonIdx + 1];
          if (after === ' ' || after === '\t') return true;
        }
      }
      return false;
    },
  },
} as const;

/* -------------------------------------------------------------------------------------------------
 * Pattern engine
 * ------------------------------------------------------------------------------------------------- */

const LANGUAGE_PATTERNS: readonly {
  language: string;
  pattern: LanguagePattern;
}[] = [
  {
    language: 'jsx',
    pattern: {
      keywords: ['classname=', 'jsx:', "from 'react'", 'from "react"'],
      custom: (code) => Heuristics.containsJsxTag(code),
    },
  },
  {
    language: 'typescript',
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
    pattern: {
      regex: /\b(?:fn|impl|struct|enum)\b/,
      keywords: ['let mut'],
      custom: (_code, lower) => lower.includes('use ') && lower.includes('::'),
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
      custom: (_code, _lower, lines) => Heuristics.bash.detectIndicators(lines),
    },
  },
  {
    language: 'css',
    pattern: {
      regex: /@media|@import|@keyframes/,
      custom: (_code, _lower, lines) => Heuristics.css.detectStructure(lines),
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
      custom: (_code, _lower, lines) => Heuristics.yaml.detectStructure(lines),
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

class PatternEngine {
  matches(sample: CodeSample, pattern: LanguagePattern): boolean {
    if (pattern.keywords?.some((kw) => sample.lower.includes(kw))) return true;
    if (
      pattern.wordBoundary?.some((w) =>
        wordMatcher.containsWord(sample.lower, w)
      )
    )
      return true;
    if (pattern.regex?.test(sample.lower)) return true;

    if (
      pattern.startsWith?.some((prefix) =>
        sample.trimmedStart.startsWith(prefix)
      )
    ) {
      return true;
    }

    if (pattern.custom?.(sample.code, sample.lower, sample.lines)) return true;

    return false;
  }
}

class LanguageDetector {
  private readonly engine = new PatternEngine();

  detect(code: string): string | undefined {
    const sample = createCodeSample(code);

    for (const { language, pattern } of LANGUAGE_PATTERNS) {
      if (this.engine.matches(sample, pattern)) return language;
    }

    return undefined;
  }
}

const detector = new LanguageDetector();

/* -------------------------------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------------------------------- */

/**
 * Detect programming language from code content using heuristics.
 */
export function detectLanguageFromCode(code: string): string | undefined {
  return detector.detect(code);
}

/**
 * Resolve language from HTML attributes (class name and data-language).
 */
export function resolveLanguageFromAttributes(
  className: string,
  dataLang: string
): string | undefined {
  return attributeResolver.resolve(className, dataLang);
}
