# AGENTS.md

## Project Overview

- superFetch is a Model Context Protocol (MCP) server that fetches web pages, extracts readable content (Mozilla Readability), and returns AI-friendly Markdown.
- Runtime modes:
  - Stdio mode (`--stdio`): MCP over stdin/stdout.
  - HTTP mode (default): Express server exposing MCP endpoints and downloads.
- Primary stack (from package.json): Node.js (>=20.18.1), TypeScript, `@modelcontextprotocol/sdk`, Express, `undici`, `@mozilla/readability`, `node-html-markdown`, `zod`.

## Repo Map / Structure

- `src/index.ts`: CLI entrypoint; selects stdio vs HTTP mode.
- `src/server.ts`: stdio MCP server (`McpServer` + `StdioServerTransport`).
- `src/http/`: HTTP server + MCP routing/session/auth.
- `src/tools/`: MCP tool registrations and handlers (e.g. `fetch-url`).
- `src/resources/`: MCP resources (e.g. cached content resources).
- `src/services/`: fetch pipeline, cache, extraction, logging, etc.
- `src/config/`: config + env parsing + constants/types.
- `src/utils/`: shared helpers (URL validation, crypto, truncation, etc.).
- `tests/`: Node test runner tests (TypeScript/JavaScript).
- `scripts/Quality-Gates.ps1`: optional PowerShell “quality gates” helper (metrics + safe refactor workflow).
- `dist/`: build output (TypeScript `outDir`; ignored by `.gitignore`).

## Setup & Environment

- Node.js: `>=20.18.1` (see `package.json#engines`).
- Install dependencies:
  - `npm install` (local dev)
  - `npm ci` (CI/reproducible installs)
- Configuration is via environment variables:
  - See `CONFIGURATION.md` and the “Configuration” section in `README.md`.
  - Stdio mode runs with defaults.
  - HTTP mode requires authentication (static tokens and/or OAuth).

## Development Workflow

- Dev (watch): `npm run dev`
- Build: `npm run build`
- Start (HTTP mode): `npm start`
- Run stdio mode after building:
  - `node dist/index.js --stdio`
- Useful utilities:
  - Format: `npm run format`
  - Lint: `npm run lint` (or `npm run lint:fix`)
  - Type-check: `npm run type-check`
  - Unused code scan: `npm run knip` (or `npm run knip:fix`)
  - MCP inspector: `npm run inspector`

## Testing

- All tests: `npm test`
- Coverage: `npm run test:coverage`
- Notes:
  - Tests run via Node’s built-in test runner (`node --test`) with `--experimental-transform-types` (expect an experimental warning).
  - Tests live under `tests/`.

## Code Style & Conventions

- Language/module system:
  - TypeScript with `module`/`moduleResolution`: `NodeNext` (see `tsconfig.json`).
  - Repo is ESM (`"type": "module"` in `package.json`).
- Formatting:
  - `npm run format` runs Prettier.
  - `.prettierrc` enables `@trivago/prettier-plugin-sort-imports` with an explicit `importOrder`.
- Linting:
  - `npm run lint` uses the flat ESLint config in `eslint.config.mjs`.
- Type checking:
  - `npm run type-check` runs `tsc --noEmit`.

## Build / Release

- Build output: `dist/` (see `tsconfig.json#compilerOptions.outDir`).
- Package entrypoints:
  - `main`: `dist/index.js`
  - `bin`: `superfetch` -> `dist/index.js`
- Release automation (GitHub Actions):
  - `.github/workflows/release.yml`: triggers on tag push matching `v*.*.*`; runs build/lint/type-check and publishes.
  - `.github/workflows/publish.yml`: triggers when a GitHub Release is published; runs build/lint/type-check and publishes (Trusted Publishing / OIDC).
- Pre-publish gate: `npm run prepublishOnly` runs `lint`, `type-check`, and `build`.

## Security & Safety

- This server fetches arbitrary URLs (open-world I/O). Treat inputs as untrusted.
- SSRF protections and URL validation are a core feature (see “Security” in `README.md`). Avoid weakening:
  - blocked private/loopback/link-local ranges
  - blocked cloud metadata endpoints
  - hostname suffix restrictions (e.g. `.local`, `.internal`)
- HTTP mode safety:
  - Authentication is required for MCP endpoints.
  - Host/Origin validation is enforced; remote bindings require OAuth.
- Secrets:
  - Provide tokens/credentials via environment variables only.
  - Never commit secrets into the repo or test fixtures.

## Pull Request / Commit Guidelines

- Before opening a PR, run the same gates CI runs:
  - `npm run lint`
  - `npm run type-check`
  - `npm test`
  - `npm run build`
- Repo does not include a PR template or a commit-message convention file; follow the contribution steps in `README.md`.
