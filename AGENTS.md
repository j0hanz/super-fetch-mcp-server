# AGENTS.md

## Project Overview

- **What this repo is**: An MCP (Model Context Protocol) server/CLI that fetches a URL, extracts readable content (Mozilla Readability), and returns AI-friendly Markdown.
- **Primary language/runtime**: TypeScript (ESM) on Node.js.
- **Package**: `@j0hanz/superfetch` (bin: `superfetch`, entry: `dist/index.js`).
- **Runtime modes**:
  - **stdio** (recommended for local MCP clients): `--stdio`
  - **HTTP** (default): starts an HTTP server

## Repo Map / Structure

- `src/`: TypeScript source
  - `src/index.ts`: CLI entrypoint (`--stdio` vs HTTP)
  - `src/mcp.ts`: stdio MCP server wiring (tools + resources)
  - `src/http.ts`: HTTP server runtime
  - `src/fetch.ts`: URL fetching + redirect handling + SSRF/DNS/IP protections
  - `src/transform.ts`: HTML → Markdown transform pipeline (includes worker pool)
  - `src/cache.ts`: cache + `superfetch://cache/...` MCP resources
  - `src/config.ts`: environment-driven configuration
- `tests/`: Node.js test suite
- `dist/`: build output (`tsc` output)
- `docs/`: static assets (e.g., `docs/logo.png`)
- `.github/workflows/`: release + publish automation

## Setup & Environment

- **Node.js**: `>=20.18.1` (from `package.json` `engines.node`).
- **Package manager**: npm (repo includes `package-lock.json`; CI uses `npm ci`).
- Install deps (clean): `npm ci`
- Install deps (dev): `npm install`

## Development Workflow

- Dev/watch (runs from TS source): `npm run dev`
- Build (outputs to `dist/`): `npm run build`
- Run from build output:
  - HTTP mode (default): `npm start`
  - stdio mode: `node dist/index.js --stdio`

## Testing

- All tests: `npm test`
- Coverage: `npm run test:coverage`
- Notes:
  - Tests run via Node’s built-in test runner (`node --test --experimental-transform-types`).
  - `npm test` runs a build first.

## Code Style & Conventions

- Language: TypeScript (ESM; `"type": "module"`)
- Type-check: `npm run type-check`
  - Diagnostics: `npm run type-check:diagnostics`
  - Trace: `npm run type-check:trace`
- Lint:
  - Check: `npm run lint`
  - Fix: `npm run lint:fix`
- Format:
  - Apply Prettier: `npm run format`
- Conventions enforced by config:
  - NodeNext module resolution; **local imports use `.js` extensions**.
  - ESLint is configured for strict type-aware rules and prefers `import { type X }` for type-only imports.

## Build / Release

- Build command: `npm run build` (TypeScript compile via `tsc -p tsconfig.build.json`).
- Output directory: `dist/`.
- CI automation:
  - Tag push `v*.*.*` triggers release workflow (build, lint, type-check, publish, GitHub release).
  - GitHub Release “published” triggers publish workflow (build, lint, type-check, publish via npm Trusted Publishing).

## Security & Safety

- This server fetches external URLs; review `README.md` and `CONFIGURATION.md` before enabling remote access.
- HTTP mode requires authentication (see configuration docs). Avoid hardcoding tokens in the repo.
- stdio mode: avoid writing non-protocol output to stdout; use stderr for logs.
