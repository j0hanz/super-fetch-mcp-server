# superFetch MCP Server — AI Usage Instructions

Use this server to fetch single public http(s) URLs, extract readable content, and return clean Markdown suitable for summarization, RAG ingestion, and citation. Prefer these tools over "remembering" state in chat.

## Operating Rules

- Only fetch sources that are necessary and likely authoritative.
- Cite using `resolvedUrl` (when present) and keep `fetchedAt`/metadata intact.
- If content is missing/truncated, check for a `resource_link` in the output and read the cache resource.
- If request is vague, ask clarifying questions.

### Strategies

- **Discovery:** Use `fetch-url` to retrieve content. Review the output for `resource_link` if the page is large.
- **Action:** Read the Markdown content directly from the tool output or the referenced resource.

## Data Model

- **Markdown Content:** `markdown` content, `title`, and `url` metadata.
- **Resources:** Cached content accessible via `superfetch://cache/{namespace}/{hash}`.

## Workflows

### 1) Fetch and Read

```text
fetch-url(url) → Get markdown content
If content truncated → read resource(superfetch://cache/...)
```

## Tools

### fetch-url

Fetches a webpage and converts it to clean Markdown format (HTML → Readability → Markdown).

- **Use when:** You need the text content of a specific public URL.
- **Args:**
  - `url` (string, required): The URL to fetch (must be http/https).
- **Returns:**
  - `structuredContent` with `markdown`, `title`, `url`.
  - Content block with standard text.
  - Or `resource_link` block if content exceeds inline limits.

## Response Shape

Success: `{ "content": [...], "structuredContent": { "markdown": "...", "title": "...", "url": "..." } }`
Error: `{ "isError": true, "structuredContent": { "error": "...", "url": "..." } }`

### Common Errors

| Code               | Meaning              | Resolution                      |
| ------------------ | -------------------- | ------------------------------- |
| `VALIDATION_ERROR` | Invalid input URL    | Ensure URL is valid http/https  |
| `FETCH_ERROR`      | Network/HTTP failure | Verify URL is public/accessible |

## Limits

- **Max Inline Characters:** 20000
- **Max Content Size:** 10MB
- **Fetch Timeout:** 15000ms

## Security

- Server blocks private/internal IP ranges (localhost, 127.x, 192.168.x, metadata services).
- Do not attempt to fetch internal network targets.
