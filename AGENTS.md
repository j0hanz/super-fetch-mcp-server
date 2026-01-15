# AGENTS.md

> **Purpose:** Context and strict guidelines for AI agents working in this repository.

## 1. Project Context

- **Domain:** MCP server that fetches web pages and transforms HTML into clean Markdown.
- **Tech Stack:**
  - **Language:** TypeScript 5.9.3 (Node.js >=20.18.1, ESM)
  - **Framework:** MCP SDK v1.x with Express 5 (HTTP) + stdio transport
  - **Key Libraries:** @modelcontextprotocol/sdk, zod, @mozilla/readability
- **Architecture:** Pipeline-based (fetch → transform → cache) with stdio + streamable HTTP entrypoints.

## 2. Repository Map (High-Level Only)

- [src](src): MCP server implementation (HTTP + stdio), fetch pipeline, transform, cache.
- [tests](tests): Node test runner suites (import compiled dist outputs).
- [scripts](scripts): Build/utility scripts (Node .mjs).
- [.github/workflows](.github/workflows): Release and publish automation.
- [docs](docs): Supplemental documentation.
  > **Note:** Ignore dist, node_modules, .venv, and \_\_pycache\_\_.

## 3. Operational Commands

- **Environment:** Node.js >=20.18.1 (ESM; TypeScript NodeNext)
- **Install:** `npm ci`
- **Dev Server:** `npm run dev` (watch compile) or `npm run dev:run` (run compiled server)
- **Test:** `npm test` (builds first, then runs node --test)
- **Build:** `npm run build`

## 4. Coding Standards (Style & Patterns)

- **Naming:** camelCase for vars/functions, PascalCase for types/classes, UPPER_CASE for constants.
- **Structure:** Keep pipeline stages in dedicated modules; prefer small helpers and early returns.
- **Typing:** Strict TypeScript; explicit return types on exported functions; no `any`.
- **Preferred Patterns:**
  - Use `.js` extensions for local imports (NodeNext ESM).
  - Use Zod `z.strictObject(...)` for tool schemas and validate before side effects.
  - Tool responses include both `structuredContent` and a JSON string in `content`.

## 5. Agent Behavioral Rules (The "Do Nots")

- **Prohibited:** Do not use default exports.
- **Prohibited:** Do not import from `zod/v3`; use `zod` (v4).
- **Prohibited:** Do not write non-MCP output to stdout in stdio mode.
- **Prohibited:** Do not edit lockfiles manually.
- **Handling Secrets:** Never output `.env` values or hardcode secrets.
- **File Creation:** Always verify folder existence before creating files.

## 6. Testing Strategy

- **Framework:** Node.js built-in test runner (`node:test`).
- **Approach:** Tests typically import compiled outputs from dist; prefer focused tests for the touched area.

## 7. Evolution & Maintenance

- **Update Rule:** If a convention changes or a new pattern is established, the agent MUST suggest an update to this file in the PR.
- **Feedback Loop:** If a build command fails twice, the correct fix MUST be recorded in the "Common Pitfalls" section.

### Common Pitfalls

- (none yet)
