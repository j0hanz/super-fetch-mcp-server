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

## Environment Variables

### Core Server Settings

| Variable        | Default              | Description                                                   |
| --------------- | -------------------- | ------------------------------------------------------------- |
| `HOST`          | `127.0.0.1`          | HTTP server bind address                                      |
| `PORT`          | `3000`               | HTTP server port (1024-65535)                                 |
| `USER_AGENT`    | `superFetch-MCP/2.0` | User-Agent header for outgoing requests                       |
| `CACHE_ENABLED` | `true`               | Enable response caching                                       |
| `CACHE_TTL`     | `3600`               | Cache lifetime in seconds (60-86400)                          |
| `LOG_LEVEL`     | `info`               | Logging verbosity: `debug`, `info`, `warn`, or `error`        |
| `ALLOW_REMOTE`  | `false`              | Allow binding to non-loopback hosts (OAuth required)          |
| `ALLOWED_HOSTS` | (empty)              | Additional allowed Host/Origin values (comma/space separated) |

### Auth (HTTP Mode)

| Variable        | Default | Description                                                  |
| --------------- | ------- | ------------------------------------------------------------ |
| `AUTH_MODE`     | auto    | `static` or `oauth`. Auto-selects OAuth if any OAUTH URL set |
| `ACCESS_TOKENS` | (empty) | Comma/space-separated static bearer tokens                   |
| `API_KEY`       | (empty) | Adds a static bearer token and enables `X-API-Key` header    |

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
