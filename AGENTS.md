# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Intelligent web content fetcher MCP server (HTML to Markdown conversion).
- **Tech Stack (Verified):**
  - **Runtime:** Node.js >= 24.13.0 (cite `package.json` engines)
  - **Languages:** TypeScript 5.9.3 (cite `package.json`)
  - **Frameworks:** Model Context Protocol (MCP) SDK (`@modelcontextprotocol/sdk`)
  - **Key Libraries:** `@mozilla/readability`, `linkedom`, `node-html-markdown`, `zod`.
  - **Build Tool:** `tsc` + Custom Task Runner (`scripts/tasks.mjs`).
- **Architecture:** Service-based / Layered (inferred from imports: services, middleware, transformers, tools).

## 2) Repository Map (High-Level)

- `src/`: Application source code (`rootDir`).
- `tests/`: Unit and integration tests.
- `scripts/`: Build and task automation scripts.
- `assets/`: Static assets (prompts, instructions).
- `dist/`: Compiled output (`outDir`).
  > Ignore generated/vendor dirs like `dist/`, `node_modules/`, `.git/`.

## 3) Operational Commands (Verified)

- **Install:** `npm install`
- **Dev:** `npm run dev` (Runs `tsc` in watch mode) or `npm run dev:run` (Runs `dist/index.js` in watch mode)
- **Test:** `npm test` (Runs `node --test` via `scripts/tasks.mjs`)
- **Build:** `npm run build` (Clean, Compile, Assets, Make Executable)
- **Lint:** `npm run lint` (ESLint)
- **Format:** `npm run format` (Prettier)
- **Type Check:** `npm run type-check` (TSC noEmit)
- **Inspector:** `npm run inspector` (MCP Inspector)

## 4) Coding Standards (Style & Patterns)

- **Naming:**
  - Variables/Functions: `camelCase` (Verified `eslint.config.mjs`)
  - Types/Classes/Enums: `PascalCase` (Verified `eslint.config.mjs`)
  - Imports: `camelCase` or `PascalCase` (Verified `eslint.config.mjs`)
- **Structure:**
  - Logic split into `services`, `transformers`, `tools`, `utils`.
  - Explicit `import type` usage required (`consistent-type-imports`).
- **Typing/Strictness:**
  - Strict TypeScript (`strict: true`, `noImplicitOverride`, `noImplicitReturns`).
  - No explicit `any` (`@typescript-eslint/no-explicit-any`: error).
- **Patterns Observed:**
  - Custom Task Runner in `scripts/tasks.mjs` handles build lifecycle.
  - Configuration single source of truth in `package.json` (version, mcpName).
  - Import sorting via `@trivago/prettier-plugin-sort-imports`.

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and running `npm install`.
- Do not edit `package-lock.json` manually.
- Do not commit secrets; never print `.env` values.
- Do not disable `eslint` rules or `typescript-eslint` strict checks without explicit justification.
- Do not use `console.log` for production logging; use the `Logger` or observability module.

## 6) Testing Strategy (Verified)

- **Framework:** Node.js Native Test Runner (`node --test`).
- **Where tests live:** `tests/*.test.ts` and `src/__tests__/*.test.ts`.
- **Approach:**
  - Unit tests co-located or in `tests/` directory.
  - Tests run against source files (requires build/loader handling in `scripts/tasks.mjs`).
  - Strict coverage checks available via `npm run test:coverage`.

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
