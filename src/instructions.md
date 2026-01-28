# superFetch Instructions

> Guidance for the Agent: These instructions are available as a resource (`internal://instructions`) or prompt (`get-help`). Load them when you are unsure about tool usage.

## 1. Core Capability

- **Domain:** Fetch public http(s) URLs, extract readable content, and return clean Markdown.
- **Primary Resources:** `fetch-url` output (`markdown`, `title`, `url`) and cache resources (`superfetch://cache/markdown/{urlHash}`).

## 2. The "Golden Path" Workflows (Critical)

_Describe the standard order of operations using ONLY tools that exist._

### Workflow A: Fetch and Read

1. Call `fetch-url` with `url`.
2. Read `structuredContent.markdown` and `structuredContent.title` from the result.
3. If content is truncated (look for `...[truncated]`), follow the returned `resource_link` URI.
   > Constraint: Never guess resource URIs. Use the returned `resource_link` or list resources first.

### Workflow B: Retrieve Cached Content

1. List resources to find available cached pages (`superfetch://cache/...`).
2. Read the specific `superfetch://cache/markdown/{urlHash}` URI.

## 3. Tool Nuances & Gotchas

_Do NOT repeat JSON schema. Focus on behavior and pitfalls._

- **`fetch-url`**
  - **Purpose:** Fetches a webpage and converts it to clean Markdown format.
  - **Inputs:** `url` (Must be public http/https. Private patterns like localhost/127.0.0.1 are blocked).
  - **Side effects:** Open world network request; writes to internal LRU cache.
  - **Latency/limits:** Network-bound. Large content exceeds inline limits and returns a `resource_link`.
  - **Common failure modes:** `VALIDATION_ERROR` (private/blocked URL), `FETCH_ERROR` (network timeout/404).

## 4. Error Handling Strategy

- **`VALIDATION_ERROR`**: Ensure the URL is valid and publicly accessible.
- **`FETCH_ERROR`**: Retry once. If persistent, the site may be blocking automated requests.
- **Truncation**: If `isError` is false but content ends in `...[truncated]`, you MUST read the provided `resource_link` URI to get the full markdown.
