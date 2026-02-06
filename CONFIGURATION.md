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

| Variable                           | Default                           | Description                                                                       |
| ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `HOST`                             | `127.0.0.1`                       | HTTP server bind address                                                          |
| `PORT`                             | `3000`                            | HTTP server port (1024-65535)                                                     |
| `USER_AGENT`                       | `superFetch-MCP│${serverVersion}` | User-Agent header for outgoing requests                                           |
| `CACHE_ENABLED`                    | `true`                            | Enable response caching                                                           |
| `LOG_LEVEL`                        | `info`                            | Logging level. Only `debug` enables verbose logs; other values behave like `info` |
| `ALLOW_REMOTE`                     | `false`                           | Allow binding to non-loopback hosts (OAuth required)                              |
| `ALLOWED_HOSTS`                    | (empty)                           | Additional allowed Host/Origin values (comma/space separated)                     |
| `FETCH_TIMEOUT_MS`                 | `15000`                           | Outgoing fetch timeout in milliseconds (1000-60000)                               |
| `SUPERFETCH_EXTRA_NOISE_TOKENS`    | (empty)                           | Additional CSS class/ID tokens to flag as noise (comma/space separated)           |
| `SUPERFETCH_EXTRA_NOISE_SELECTORS` | (empty)                           | Additional CSS selectors for noise removal (comma/space separated)                |

### Auth (HTTP Mode)

| Variable        | Default | Description                                               |
| --------------- | ------- | --------------------------------------------------------- |
| `ACCESS_TOKENS` | (empty) | Comma/space-separated static bearer tokens                |
| `API_KEY`       | (empty) | Adds a static bearer token and enables `X-API-Key` header |

Static mode requires at least one token (`ACCESS_TOKENS` or `API_KEY`). OAuth is auto-selected when any OAuth URL is set.

### OAuth (HTTP Mode)

Required when `AUTH_MODE=oauth` (or auto-selected by presence of OAuth URLs):

| Variable                  | Default | Description            |
| ------------------------- | ------- | ---------------------- |
| `OAUTH_ISSUER_URL`        | -       | OAuth issuer           |
| `OAUTH_AUTHORIZATION_URL` | -       | Authorization endpoint |
| `OAUTH_TOKEN_URL`         | -       | Token endpoint         |
| `OAUTH_INTROSPECTION_URL` | -       | Introspection endpoint |

Optional:

| Variable                 | Default | Description                             |
| ------------------------ | ------- | --------------------------------------- |
| `OAUTH_REVOCATION_URL`   | -       | Revocation endpoint                     |
| `OAUTH_REGISTRATION_URL` | -       | Dynamic client registration endpoint    |
| `OAUTH_REQUIRED_SCOPES`  | (empty) | Required scopes (comma/space separated) |
| `OAUTH_CLIENT_ID`        | -       | Client ID for introspection             |
| `OAUTH_CLIENT_SECRET`    | -       | Client secret for introspection         |

### Parsing Rules

- **Integers**: Parsed with `parseInt`. Invalid values use defaults.
- **Booleans**: The string `false` (lowercase) is `false`; any other non-empty value is `true`.

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
<summary><strong>Long Cache</strong> - Extended cache for speed</summary>

Cache TTL is hardcoded at 3600 seconds (1 hour). To disable caching entirely:

```json
{
  "servers": {
    "superFetch": {
      "command": "npx",
      "args": ["-y", "@j0hanz/superfetch@latest", "--stdio"],
      "env": {
        "CACHE_ENABLED": "false"
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

| Setting                     | Value                       | Notes                              |
| --------------------------- | --------------------------- | ---------------------------------- |
| Fetch timeout               | 15 seconds                  | Fast failure for unresponsive URLs |
| Transform timeout           | 30 seconds                  | HTML-to-Markdown conversion        |
| Tool timeout                | 50 seconds                  | fetch + transform + 5s padding     |
| Max redirects               | 5                           | Per request                        |
| Cache TTL                   | 3600 seconds                | 1 hour                             |
| Cache max entries           | 100                         | LRU eviction when exceeded         |
| Max HTML bytes              | Unlimited                   | No cap on download size            |
| Max inline content chars    | Unlimited                   | No inline truncation               |
| Metadata format             | `markdown`                  | Title-first preamble               |
| Transform stage warn ratio  | 0.5                         | Warn when stage exceeds 50%        |
| Max worker scale            | 4                           | Worker pool scale factor           |
| Enabled tools               | `fetch-url`                 | Single tool                        |
| Noise weights               | hidden/structural=50, etc.  | DOM noise scoring                  |
| Noise categories            | cookie, newsletter, social… | Default enabled categories         |
| Aggressive noise mode       | Disabled                    | Lower false-positive risk          |
| Markdown cleanup            | All enabled                 | Headings, skip links, TOC, TypeDoc |
| Rate limit                  | 100 req/min                 | HTTP mode only, per IP             |
| Auth mode                   | Auto-detected               | OAuth when URLs set, else static   |
| OAuth resource URL          | `http://<host>:<port>/mcp`  | Computed from HOST/PORT            |
| OAuth introspection timeout | 5 seconds                   | Introspection deadline             |
| Shutdown behavior           | Close idle connections      | Always enabled                     |
| Session TTL                 | 30 minutes                  | HTTP mode only                     |
| Session init timeout        | 10 seconds                  | HTTP mode only                     |
| Max sessions                | 200                         | HTTP mode only                     |
