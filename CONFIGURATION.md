# Configuration Reference

SuperFetch is configured with environment variables. Set them in your MCP client configuration (the `env` field) or in the shell before starting the server.

## Quick Start

SuperFetch runs with no configuration by default. Just run with `--stdio`:

```json
{
  "servers": {
    "superFetch": {
      "command": "npx",
      "args": ["-y", "@j0hanz/superfetch@latest", "--stdio"]
    }
  }
}
```

## Runtime Modes

| Mode  | Flag      | Description                                                         |
| ----- | --------- | ------------------------------------------------------------------- |
| Stdio | `--stdio` | Communicates via stdin/stdout. No HTTP server.                      |
| HTTP  | (default) | Starts an HTTP server. Requires static token(s) or OAuth to be set. |

**HTTP Mode Notes:**

- Default bind is `127.0.0.1`. Non-loopback `HOST` values require `ALLOW_REMOTE=true`.
- To bind to all interfaces, set `HOST=0.0.0.0` or `HOST=::`, set `ALLOW_REMOTE=true`, and configure OAuth (remote bindings require OAuth).
- Authentication is always required via `Authorization: Bearer <token>` (static mode also accepts `X-API-Key`).
- HTTP mode requires `mcp-protocol-version: 2025-11-25`. Missing headers are assumed to be `2025-03-26` and rejected as unsupported.

## Environment Variables

### Core Server Settings

| Variable                     | Default              | Description                                                                                           |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `HOST`                       | `127.0.0.1`          | HTTP server bind address                                                                              |
| `PORT`                       | `3000`               | HTTP server port (1024-65535)                                                                         |
| `USER_AGENT`                 | `superFetch-MCP/2.0` | User-Agent header for outgoing requests                                                               |
| `CACHE_ENABLED`              | `true`               | Enable response caching                                                                               |
| `CACHE_TTL`                  | `3600`               | Cache lifetime in seconds (60-86400)                                                                  |
| `LOG_LEVEL`                  | `info`               | Logging level. Only `debug` enables verbose logs; other values behave like `info`                     |
| `ALLOW_REMOTE`               | `false`              | Allow binding to non-loopback hosts (OAuth required)                                                  |
| `ALLOWED_HOSTS`              | (empty)              | Additional allowed Host/Origin values (comma/space separated)                                         |
| `FETCH_TIMEOUT_MS`           | `15000`              | Outgoing fetch timeout in milliseconds (1000-60000)                                                   |
| `TRANSFORM_TIMEOUT_MS`       | `30000`              | Worker transform timeout in milliseconds (5000-120000)                                                |
| `TOOL_TIMEOUT_MS`            | `50000`              | Overall tool timeout in milliseconds (1000-300000). Defaults to 15000 + `TRANSFORM_TIMEOUT_MS` + 5000 |
| `TRANSFORM_METADATA_FORMAT`  | `markdown`           | Metadata preamble format: `markdown` (title-first) or `frontmatter` (YAML)                            |
| `TRANSFORM_STAGE_WARN_RATIO` | `0.5`                | Emit a warning when a transform stage uses more than this fraction of the total budget                |
| `TRANSFORM_WORKER_MAX_SCALE` | `4`                  | Max worker pool scale factor (0-16)                                                                   |
| `ENABLED_TOOLS`              | `fetch-url`          | Comma/space-separated list of enabled tools                                                           |

### HTTP Server Tuning (HTTP Mode, Advanced)

These settings tune the underlying Node.js `http.Server`. All defaults are **no-op** unless you set the variables.

> Caution: `SERVER_REQUEST_TIMEOUT_MS` can break long-lived Streamable HTTP / MCP sessions. Prefer `SERVER_HEADERS_TIMEOUT_MS` and `SERVER_KEEP_ALIVE_TIMEOUT_MS` unless you know you want a hard request deadline.

| Variable                       | Default | Description                                                  |
| ------------------------------ | ------- | ------------------------------------------------------------ |
| `SERVER_HEADERS_TIMEOUT_MS`    | (unset) | Sets `server.headersTimeout` (1000-600000)                   |
| `SERVER_REQUEST_TIMEOUT_MS`    | (unset) | Sets `server.requestTimeout` (1000-600000)                   |
| `SERVER_KEEP_ALIVE_TIMEOUT_MS` | (unset) | Sets `server.keepAliveTimeout` (1000-600000)                 |
| `SERVER_SHUTDOWN_CLOSE_IDLE`   | `false` | On shutdown, call `server.closeIdleConnections()` if present |
| `SERVER_SHUTDOWN_CLOSE_ALL`    | `false` | On shutdown, call `server.closeAllConnections()` if present  |

### Auth (HTTP Mode)

| Variable        | Default | Description                                                                                                                              |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_MODE`     | auto    | `static` or `oauth`. Auto-selects OAuth if OAUTH_ISSUER_URL, OAUTH_AUTHORIZATION_URL, OAUTH_TOKEN_URL, or OAUTH_INTROSPECTION_URL is set |
| `ACCESS_TOKENS` | (empty) | Comma/space-separated static bearer tokens                                                                                               |
| `API_KEY`       | (empty) | Adds a static bearer token and enables `X-API-Key` header                                                                                |

Static mode requires at least one token (`ACCESS_TOKENS` or `API_KEY`).

### OAuth (HTTP Mode)

Required when `AUTH_MODE=oauth` (or auto-selected by presence of OAuth URLs):

| Variable                  | Default | Description            |
| ------------------------- | ------- | ---------------------- |
| `OAUTH_ISSUER_URL`        | -       | OAuth issuer           |
| `OAUTH_AUTHORIZATION_URL` | -       | Authorization endpoint |
| `OAUTH_TOKEN_URL`         | -       | Token endpoint         |
| `OAUTH_INTROSPECTION_URL` | -       | Introspection endpoint |

Optional:

| Variable                         | Default                    | Description                             |
| -------------------------------- | -------------------------- | --------------------------------------- |
| `OAUTH_REVOCATION_URL`           | -                          | Revocation endpoint                     |
| `OAUTH_REGISTRATION_URL`         | -                          | Dynamic client registration endpoint    |
| `OAUTH_RESOURCE_URL`             | `http://<host>:<port>/mcp` | Protected resource URL                  |
| `OAUTH_REQUIRED_SCOPES`          | (empty)                    | Required scopes (comma/space separated) |
| `OAUTH_CLIENT_ID`                | -                          | Client ID for introspection             |
| `OAUTH_CLIENT_SECRET`            | -                          | Client secret for introspection         |
| `OAUTH_INTROSPECTION_TIMEOUT_MS` | `5000`                     | Introspection timeout (1000-30000)      |

### Parsing Rules

- **Integers**: Parsed with `parseInt`. Invalid values use defaults.
- **Booleans**: The string `false` (lowercase) is `false`; any other non-empty value is `true`.

### Noise Removal Tuning (Advanced)

Control DOM noise filtering behavior. Higher weights increase likelihood of removal.

| Variable                           | Default                                              | Description                                                              |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `NOISE_WEIGHT_HIDDEN`              | `50`                                                 | Weight for hidden elements (0-100)                                       |
| `NOISE_WEIGHT_STRUCTURAL`          | `50`                                                 | Weight for structural noise tags like script, style (0-100)              |
| `NOISE_WEIGHT_PROMO`               | `35`                                                 | Weight for promotional content (banners, ads) (0-100)                    |
| `NOISE_WEIGHT_STICKY_FIXED`        | `30`                                                 | Weight for fixed/sticky positioned elements (0-100)                      |
| `NOISE_WEIGHT_THRESHOLD`           | `50`                                                 | Removal threshold: elements with score ≥ threshold are removed (0-100)   |
| `SUPERFETCH_EXTRA_NOISE_TOKENS`    | (empty)                                              | Additional CSS class/ID tokens to flag as noise (comma/space separated)  |
| `SUPERFETCH_EXTRA_NOISE_SELECTORS` | (empty)                                              | Additional CSS selectors for noise removal (comma/space separated)       |
| `NOISE_REMOVAL_CATEGORIES`         | `cookie-banners,newsletters,social-share,nav-footer` | Enabled noise categories (comma/space separated)                         |
| `SUPERFETCH_AGGRESSIVE_NOISE`      | `false`                                              | Enable aggressive mode (includes tokens with higher false-positive risk) |
| `SUPERFETCH_PRESERVE_SVG_CANVAS`   | `false`                                              | Preserve SVG and canvas elements (don't treat as structural noise)       |
| `DEBUG_NOISE_REMOVAL`              | `false`                                              | Log noise removal decisions for debugging                                |

### Markdown Cleanup Tuning (Advanced)

Control post-processing of converted markdown.

| Variable                           | Default | Description                                             |
| ---------------------------------- | ------- | ------------------------------------------------------- |
| `MARKDOWN_PROMOTE_ORPHAN_HEADINGS` | `true`  | Auto-promote title-case lines to headings               |
| `MARKDOWN_REMOVE_SKIP_LINKS`       | `true`  | Remove "Skip to content/navigation" accessibility links |
| `MARKDOWN_REMOVE_TOC_BLOCKS`       | `true`  | Remove auto-generated table of contents blocks          |
| `MARKDOWN_REMOVE_TYPEDOC_COMMENTS` | `true`  | Remove TypeDoc-style comments from markdown             |

### Rate Limiting (HTTP Mode)

These settings control the per-IP HTTP request rate limiter.

| Variable               | Default | Description                          |
| ---------------------- | ------- | ------------------------------------ |
| `RATE_LIMIT_MAX`       | `100`   | Max requests per window (1-10000)    |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window duration in ms (1000-3600000) |

## Configuration Presets

<details open>
<summary><strong>Default (Recommended)</strong></summary>

```json
{
  "servers": {
    "superFetch": {
      "command": "npx",
      "args": ["-y", "@j0hanz/superfetch@latest", "--stdio"]
    }
  }
}
```

</details>

<details>
<summary><strong>Debug Mode</strong> - Verbose logging, no cache</summary>

```json
{
  "servers": {
    "superFetch": {
      "command": "npx",
      "args": ["-y", "@j0hanz/superfetch@latest", "--stdio"],
      "env": {
        "LOG_LEVEL": "debug",
        "CACHE_ENABLED": "false"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Long Cache</strong> - 2-hour cache for speed</summary>

```json
{
  "servers": {
    "superFetch": {
      "command": "npx",
      "args": ["-y", "@j0hanz/superfetch@latest", "--stdio"],
      "env": {
        "CACHE_TTL": "7200"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Custom User Agent</strong> - For sites that block bots</summary>

```json
{
  "servers": {
    "superFetch": {
      "command": "npx",
      "args": ["-y", "@j0hanz/superfetch@latest", "--stdio"],
      "env": {
        "USER_AGENT": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    }
  }
}
```

</details>

## HTTP Mode Example

Run HTTP server on loopback with a static token:

```bash
API_KEY=your-secret-key npm start
```

Run HTTP server accessible from all interfaces (OAuth required):

```bash
HOST=0.0.0.0 PORT=8080 \
ALLOW_REMOTE=true \
OAUTH_ISSUER_URL=https://issuer.example \
OAUTH_AUTHORIZATION_URL=https://issuer.example/authorize \
OAUTH_TOKEN_URL=https://issuer.example/token \
OAUTH_INTROSPECTION_URL=https://issuer.example/introspect \
npm start
```

## Hardcoded Defaults

These values are not configurable (sensible defaults for all use cases):

| Setting               | Value        | Notes                                |
| --------------------- | ------------ | ------------------------------------ |
| Request timeout       | 15 seconds   | Fast failure for unresponsive URLs   |
| Max redirects         | 5            | Per request                          |
| Max response size     | 10 MB        | HTML responses larger than this fail |
| Inline markdown limit | 20,000 chars | Used for tool output                 |
| Cache max entries     | 100          | LRU eviction when exceeded           |
| Session TTL           | 30 minutes   | HTTP mode only                       |
| Session init timeout  | 10 seconds   | HTTP mode only                       |
| Max sessions          | 200          | HTTP mode only                       |
| Rate limit            | 100 req/min  | HTTP mode only, per IP               |
