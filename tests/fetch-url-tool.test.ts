import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { NodeHtmlMarkdown } from 'node-html-markdown';

import * as cache from '../dist/cache.js';
import { config } from '../dist/config.js';
import { normalizeUrl } from '../dist/fetch.js';
import { cleanupMarkdownArtifacts } from '../dist/markdown-cleanup.js';
import { fetchUrlToolHandler } from '../dist/tools.js';
import {
  htmlToMarkdown,
  shutdownTransformWorkerPool,
} from '../dist/transform.js';

after(async () => {
  await shutdownTransformWorkerPool();
});

type FetchUrlResponse = Awaited<ReturnType<typeof fetchUrlToolHandler>>;

function assertTextBlockMatchesStructured(response: FetchUrlResponse): void {
  const textBlock = response.content.find((block) => block.type === 'text');
  assert.ok(textBlock && textBlock.type === 'text');

  const parsed = JSON.parse(textBlock.text) as unknown;
  assert.equal(typeof parsed, 'object');
  assert.ok(parsed && !Array.isArray(parsed));
  assert.deepEqual(parsed, response.structuredContent);
}

describe('fetchUrlToolHandler', () => {
  it('inserts spaces after inline links/code without touching fenced code blocks', () => {
    const input = [
      'Chakra UI relies on [next-themes](https://example.com)to add support.',
      '',
      'In most cases, it is set up in the `Provider`component.',
      '',
      '```js',
      'const x = "[next-themes](https://example.com)to";',
      'const y = "`Provider`component";',
      '```',
    ].join('\n');

    const cleaned = cleanupMarkdownArtifacts(input);

    assert.ok(
      cleaned.includes(
        'Chakra UI relies on [next-themes](https://example.com) to add support.'
      )
    );
    assert.ok(
      cleaned.includes(
        'In most cases, it is set up in the `Provider` component.'
      )
    );
    assert.ok(
      cleaned.includes('const x = "[next-themes](https://example.com)to";')
    );
    assert.ok(cleaned.includes('const y = "`Provider`component";'));
  });

  it('returns a validation error when url is missing', async () => {
    const response = await fetchUrlToolHandler({ url: '' });

    assert.equal(response.isError, true);
    assert.deepEqual(response.structuredContent, {
      error: 'URL is required',
      url: '',
    });
  });

  it('returns markdown content for successful fetches', async (t) => {
    const html =
      '<html><head><title>Test Page</title></head><body><p>Hello</p></body></html>';

    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    const response = await fetchUrlToolHandler({
      url: 'https://example.com/test',
    });

    const structured = response.structuredContent;
    assert.ok(structured);
    assert.equal(structured.url, 'https://example.com/test');
    assert.equal(typeof structured.markdown, 'string');
    assert.ok((structured.markdown as string).includes('Hello'));
    assertTextBlockMatchesStructured(response);
  });

  it('respects cancellation via the MCP request abort signal', async (t) => {
    const controller = new AbortController();
    controller.abort();

    t.mock.method(
      globalThis,
      'fetch',
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as unknown;
        if (
          typeof signal === 'object' &&
          signal !== null &&
          'aborted' in signal &&
          (signal as { aborted?: unknown }).aborted === true
        ) {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Response('<html><body>ok</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
    );

    const url = 'https://example.com/cancelled-test';
    const response = await fetchUrlToolHandler(
      { url },
      { signal: controller.signal }
    );

    assert.equal(response.isError, true);
    const structured = response.structuredContent;
    assert.ok(structured);
    assert.equal(structured.url, url);
    assert.match(String(structured.error), /cancel|abort/i);
  });

  it('exposes truncated flag when inline content is trimmed', async (t) => {
    const originalCacheEnabled = config.cache.enabled;
    const originalInlineLimit = config.constants.maxInlineContentChars;
    config.cache.enabled = false;
    config.constants.maxInlineContentChars = 20000;

    const html = `<html><body><p>${'a'.repeat(21000)}</p></body></html>`;

    try {
      t.mock.method(globalThis, 'fetch', async () => {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      });

      const response = await fetchUrlToolHandler({
        url: 'https://example.com/large',
      });

      const structured = response.structuredContent;
      assert.ok(structured);
      assert.equal(structured.truncated, true);
    } finally {
      config.cache.enabled = originalCacheEnabled;
      config.constants.maxInlineContentChars = originalInlineLimit;
    }
  });

  it('exposes truncated flag when cached transform indicates truncation', async () => {
    const url = 'https://example.com/html-truncation';
    const normalizedUrl = normalizeUrl(url).normalizedUrl;
    const cacheKey = cache.createCacheKey('markdown', normalizedUrl);

    assert.ok(cacheKey);
    cache.set(
      cacheKey,
      JSON.stringify({ markdown: 'cached content', truncated: true }),
      { url: normalizedUrl }
    );

    const response = await fetchUrlToolHandler({ url });
    const structured = response.structuredContent;
    assert.ok(structured);
    assert.equal(structured.truncated, true);
  });

  it('returns truncated markdown even when cache + http mode are enabled', async (t) => {
    const originalHttpMode = config.runtime.httpMode;
    const originalCacheEnabled = config.cache.enabled;
    const originalInlineLimit = config.constants.maxInlineContentChars;
    config.runtime.httpMode = true;
    config.cache.enabled = true;
    config.constants.maxInlineContentChars = 20000;

    const html = `<html><body><p>${'a'.repeat(25000)}</p></body></html>`;

    try {
      t.mock.method(globalThis, 'fetch', async () => {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      });

      const response = await fetchUrlToolHandler({
        url: 'https://example.com/large-http',
      });

      const structured = response.structuredContent;
      assert.ok(structured);
      assert.equal(structured.truncated, true);
      assert.equal(typeof structured.markdown, 'string');
      assert.ok(String(structured.markdown).includes('[truncated]'));
      assertTextBlockMatchesStructured(response);

      const resourceBlock = response.content.find(
        (block) => block.type === 'resource'
      );
      assert.ok(resourceBlock && resourceBlock.type === 'resource');
      assert.equal(resourceBlock.resource.mimeType, 'text/markdown');
      assert.equal(resourceBlock.resource.text, structured.markdown);

      const resourceLinkBlock = response.content.find(
        (block) => block.type === 'resource_link'
      );
      assert.ok(
        resourceLinkBlock && resourceLinkBlock.type === 'resource_link'
      );
      assert.match(resourceLinkBlock.uri, /^superfetch:\/\/cache\/markdown\//);
    } finally {
      config.runtime.httpMode = originalHttpMode;
      config.cache.enabled = originalCacheEnabled;
      config.constants.maxInlineContentChars = originalInlineLimit;
    }
  });

  it('preserves anchor lists without a TOC heading', async (t) => {
    const html = `
      <html>
        <body>
          <ul>
            <li><a href="#intro">Intro</a></li>
            <li><a href="#usage">Usage</a></li>
          </ul>
        </body>
      </html>
    `;

    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    const response = await fetchUrlToolHandler({
      url: 'https://example.com/anchors',
    });

    const structured = response.structuredContent;
    assert.ok(structured);
    const markdown = String(structured.markdown);
    assert.ok(markdown.includes('[Intro](#intro)'));
    assert.ok(markdown.includes('[Usage](#usage)'));
  });

  it('preserves raw markdown content even with inline HTML', async (t) => {
    const rawContent =
      '# Title\n\n<details><summary>More</summary>Details</details>';

    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(rawContent, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    });

    const response = await fetchUrlToolHandler({
      url: 'https://example.com/readme.md',
    });

    const structured = response.structuredContent;
    assert.ok(structured);
    const markdown = String(structured.markdown);
    assert.ok(markdown.includes('<details>'));
    assert.ok(markdown.includes('Source: https://example.com/readme.md'));
    assertTextBlockMatchesStructured(response);
  });

  it('falls back to UTF-8 for invalid charset labels in worker transforms', async (t) => {
    const html = '<html><body><p>café</p></body></html>';
    const utf8 = Buffer.from(html, 'utf-8');

    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(utf8, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=invalid-charset',
        },
      });
    });

    const response = await fetchUrlToolHandler({
      url: 'https://example.com/invalid-charset',
    });

    assert.equal(response.isError, undefined);
    const structured = response.structuredContent;
    assert.ok(structured);
    assert.equal(typeof structured.markdown, 'string');
    assert.match(String(structured.markdown), /café/);
    assertTextBlockMatchesStructured(response);
  });

  it('returns an error response when markdown conversion fails', async (t) => {
    // Ensure clean state
    await shutdownTransformWorkerPool();

    // Disable worker pool to force in-process transform which uses the mocked NodeHtmlMarkdown
    const originalMaxWorkerScale = config.transform.maxWorkerScale;
    config.transform.maxWorkerScale = 0;

    try {
      t.mock.method(NodeHtmlMarkdown.prototype, 'translate', () => {
        throw new Error('Translate failed');
      });

      t.mock.method(globalThis, 'fetch', async () => {
        return new Response('<html><body><p>Fail</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      });

      const response = await fetchUrlToolHandler({
        url: 'https://example.com/convert-fail',
      });

      assert.equal(response.isError, true);
      const structured = response.structuredContent;
      assert.ok(structured);
      assert.match(String(structured.error), /convert|markdown/i);
    } finally {
      config.transform.maxWorkerScale = originalMaxWorkerScale;
    }
  });

  it('includes status code and details for fetch errors', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response('busy', {
        status: 429,
        headers: { 'retry-after': '30' },
      });
    });

    const response = await fetchUrlToolHandler({
      url: 'https://example.com/rate-limited',
    });

    assert.equal(response.isError, true);
    const structured = response.structuredContent;
    assert.ok(structured);
    assert.equal(structured.statusCode, 429);
    const details = structured.details as { retryAfter?: number } | undefined;
    assert.equal(details?.retryAfter, 30);
  });

  it('closes tilde code fences when truncating inline content', async (t) => {
    const originalInlineLimit = config.constants.maxInlineContentChars;
    config.constants.maxInlineContentChars = 20000;
    const longBody = 'a'.repeat(config.constants.maxInlineContentChars + 500);
    const rawContent = `# Title\n\n~~~\n${longBody}\n~~~\n`;

    try {
      t.mock.method(globalThis, 'fetch', async () => {
        return new Response(rawContent, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      });

      const response = await fetchUrlToolHandler({
        url: 'https://example.com/tilde-fence',
      });

      const structured = response.structuredContent;
      assert.ok(structured);
      assert.equal(structured.truncated, true);
      const markdown = String(structured.markdown);
      assert.match(markdown, /~~~\n\.\.\.\[truncated\]/);
      assert.equal(markdown.includes('```\n...[truncated]'), false);
    } finally {
      config.constants.maxInlineContentChars = originalInlineLimit;
    }
  });

  it('converts html fragments even when markdown-like markers appear', async (t) => {
    const html = `<div>\n# Title\n</div>\n<p>Body</p>`;

    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    });

    const response = await fetchUrlToolHandler({
      url: 'https://example.com/html-fragment',
    });

    const structured = response.structuredContent;
    assert.ok(structured);
    const markdown = String(structured.markdown);
    assert.equal(markdown.includes('<div>'), false);
    assert.equal(markdown.includes('<p>'), false);
  });

  it('does not drop aggressive promo matches inside main content', () => {
    const originalAggressiveMode = config.noiseRemoval.aggressiveMode;
    config.noiseRemoval.aggressiveMode = true;

    const html = `
      <html>
        <body>
          <main>
            <div class="related fixed"><p>KEEP_RELATED</p></div>
          </main>
        </body>
      </html>
    `;

    try {
      const markdown = htmlToMarkdown(html);
      assert.match(markdown, /KEEP\\?_RELATED/);
    } finally {
      config.noiseRemoval.aggressiveMode = originalAggressiveMode;
    }
  });
});

describe('htmlToMarkdown resolves parenthesized URLs correctly', () => {
  it('preserves balanced parentheses in resolved relative URLs', () => {
    const html = '<a href="/wiki/Foo_(bar)">Foo (bar)</a>';
    const result = htmlToMarkdown(html, undefined, {
      url: 'https://en.wikipedia.org/wiki/Main_Page',
    });
    assert.match(
      result,
      /\[Foo \(bar\)\]\(https:\/\/en\.wikipedia\.org\/wiki\/Foo(?:_|%5F)(%28|\()bar(%29|\))\)/,
      'Link with parenthesized URL should resolve correctly'
    );
  });

  it('handles simple relative URLs without parentheses', () => {
    const html = '<a href="/about">About</a>';
    const result = htmlToMarkdown(html, undefined, {
      url: 'https://example.com/page',
    });
    assert.match(result, /\[About\]\(https:\/\/example\.com\/about\)/);
  });
});
