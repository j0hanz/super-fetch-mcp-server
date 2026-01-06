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

| Mode  | Flag      | Description                                          |
| ----- | --------- | ---------------------------------------------------- |
| Stdio | `--stdio` | Communicates via stdin/stdout. No HTTP server.       |
| HTTP  | (default) | Starts an HTTP server. Requires `API_KEY` to be set. |

**HTTP Mode Notes:**

- Binding to `0.0.0.0` or `::` allows remote connections automatically.
- Authentication is always required via `Authorization: Bearer <API_KEY>` or `X-API-Key: <API_KEY>`.

## Environment Variables

SuperFetch uses only 7 configuration options. Everything else uses sensible defaults.

### Core Settings

| Variable        | Default              | Description                                             |
| --------------- | -------------------- | ------------------------------------------------------- |
| `API_KEY`       | -                    | **Required for HTTP mode.** Authentication key.         |
| `HOST`          | `127.0.0.1`          | HTTP server bind address.                               |
| `PORT`          | `3000`               | HTTP server port (1024-65535).                          |
| `USER_AGENT`    | `superFetch-MCP/1.0` | Custom User-Agent header for outgoing requests.         |
| `CACHE_ENABLED` | `true`               | Enable response caching.                                |
| `CACHE_TTL`     | `3600`               | Cache lifetime in seconds (60-86400).                   |
| `LOG_LEVEL`     | `info`               | Logging verbosity: `debug`, `info`, `warn`, or `error`. |

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

Run HTTP server accessible from all interfaces:

```bash
API_KEY=your-secret-key HOST=0.0.0.0 PORT=8080 npm start
```

## Hardcoded Defaults

These values are not configurable (sensible defaults for all use cases):

| Setting           | Value       | Notes                                |
| ----------------- | ----------- | ------------------------------------ |
| Request timeout   | 15 seconds  | Fast failure for unresponsive URLs   |
| Max response size | 10 MB       | HTML responses larger than this fail |
| Cache max entries | 100         | LRU eviction when exceeded           |
| Session TTL       | 30 minutes  | HTTP mode only                       |
| Max sessions      | 200         | HTTP mode only                       |
| Rate limit        | 100 req/min | HTTP mode only, per IP               |
