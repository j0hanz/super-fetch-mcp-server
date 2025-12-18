const LANGUAGE_PATTERNS = [
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
    /^\s*(export|const|let|var|function|class|async|await)\b|^\s*import\s+.*['"]/m,
    'javascript',
  ],
  // Python patterns
  [/^\s*(def|class|import|from|if __name__|print\()/m, 'python'],
  // Bash/Shell patterns
  [
    /^\s*(npm|yarn|pnpm|npx|brew|apt|pip|cargo|go )\s+(install|add|run|build|start)/m,
    'bash',
  ],
  [/^\s*[$#]\s+\w+|^\s*#!|^\s*(sudo|chmod|mkdir|cd|ls|cat|echo)\s+/m, 'bash'],
  // CSS patterns
  [/^\s*[.#@]?[\w-]+\s*\{[^}]*\}|@media|@import|@keyframes/m, 'css'],
  // HTML patterns
  [/^\s*<(!DOCTYPE|html|head|body|div|span|p|a|script|style)\b/im, 'html'],
  // JSON patterns
  [/^\s*\{\s*"|^\s*\[\s*("|\d|true|false|null)/m, 'json'],
  // YAML patterns
  [/^\s*[\w-]+:\s*.+$/m, 'yaml'],
  // SQL patterns
  [/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/im, 'sql'],
  // Go patterns
  [/^\s*(func|package|import\s+")/m, 'go'],
] as const;

export function detectLanguage(code: string): string | undefined {
  return LANGUAGE_PATTERNS.find(([pattern]) => pattern.test(code))?.[1];
}
