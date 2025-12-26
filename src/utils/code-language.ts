const CODE_PATTERNS: readonly [RegExp, string][] = [
  [
    /^\s*import\s+.*\s+from\s+['"]react['"]|<[A-Z][a-zA-Z]*[\s/>]|jsx\s*:|className=/m,
    'jsx',
  ],
  [
    /:\s*(string|number|boolean|void|any|unknown|never)\b|interface\s+\w+|type\s+\w+\s*=/m,
    'typescript',
  ],
  [/^\s*(fn|let\s+mut|impl|struct|enum|use\s+\w+::)/m, 'rust'],
  [
    /^\s*(export|const|let|var|function|class|async|await)\b|^\s*import\s+.*['"]]/m,
    'javascript',
  ],
  [/^\s*(def|class|import|from|if __name__|print\()/m, 'python'],
  [
    /^\s*(npm|yarn|pnpm|npx|brew|apt|pip|cargo|go )\s+(install|add|run|build|start)/m,
    'bash',
  ],
  [/^\s*[$#]\s+\w+|^\s*#!|^\s*(sudo|chmod|mkdir|cd|ls|cat|echo)\s+/m, 'bash'],
  [/^\s*[.#@]?[\w-]+\s*\{[^}]*\}|@media|@import|@keyframes/m, 'css'],
  [/^\s*<(!DOCTYPE|html|head|body|div|span|p|a|script|style)\b/im, 'html'],
  [/^\s*\{\s*"|^\s*\[\s*("|\d|true|false|null)/m, 'json'],
  [/^\s*[\w-]+:\s*.+$/m, 'yaml'],
  [/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/im, 'sql'],
  [/^\s*(func|package|import\s+")/m, 'go'],
];

const CLASS_PATTERNS = [
  /language-(\w+)/,
  /lang-(\w+)/,
  /highlight-(\w+)/,
] as const;

export function detectLanguageFromCode(code: string): string | undefined {
  for (const [pattern, language] of CODE_PATTERNS) {
    if (pattern.test(code)) {
      return language;
    }
  }
  return undefined;
}

export function resolveLanguageFromAttributes(
  className: string,
  dataLang: string
): string | undefined {
  const classMatch = matchFirstCapture(className, CLASS_PATTERNS);
  return classMatch ?? resolveLanguageFromDataAttribute(dataLang);
}

function matchFirstCapture(
  value: string,
  patterns: readonly RegExp[]
): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function resolveLanguageFromDataAttribute(
  dataLang: string
): string | undefined {
  const match = /^(\w+)$/.exec(dataLang);
  return match?.[1];
}
