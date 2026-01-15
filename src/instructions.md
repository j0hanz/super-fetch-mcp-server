# superFetch Instructions

> **Guidance for the Agent:** These instructions are available as a resource (`internal://instructions`). Load them when you are confused about tool usage.

## 1. Core Capability

- **Domain:** Fetch public http(s) URLs, extract readable content, and return clean Markdown.
- **Primary Resources:** `fetch-url` output (`markdown`, `title`, `url`) and cache resources (`superfetch://cache/markdown/{urlHash}`).

## 2. The "Golden Path" Workflows (Critical)

### Workflow A: Fetch and Read

1. Call `fetch-url` with a public http(s) URL.
2. Read `structuredContent.markdown` and `structuredContent.title`.
3. Cite using `resolvedUrl` or `url` from the response.

### Workflow B: Large Content / Cache Resource

1. If the response includes a `resource_link`, read that resource URI.
2. If content is missing, list resources and select the matching `superfetch://cache/markdown/{urlHash}` entry.
   > **Constraint:** Never guess resource URIs. Use the returned `resource_link` or list resources first.

## 3. Tool Nuances & "Gotchas"

- **`fetch-url`**:
  - **Latency:** Network-bound; expect slower responses for large pages.
  - **Side Effects:** Calls external websites (open-world).
  - **Input:** `url` must be public http/https. Private/internal addresses are blocked.
  - **Output:** Large content may return a `resource_link` instead of full inline markdown.
- **Cache resources (`superfetch://cache/markdown/{urlHash}`)**:
  - **Namespace:** Only `markdown` is valid.
  - **Discovery:** Use resource listing or the `resource_link` returned by `fetch-url`.

## 4. Error Handling Strategy

- **`VALIDATION_ERROR`**: URL is invalid or blocked. Confirm it is a public http(s) URL.
- **`FETCH_ERROR`**: Network/HTTP failure. Retry or verify the site is reachable.
- **Cache miss (`Content not found`)**: Re-run `fetch-url` or verify the cache entry exists.
