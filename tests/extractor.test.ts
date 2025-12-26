import { describe, expect, it } from 'vitest';

import { extractContent } from '../src/services/extractor.js';

describe('extractContent', () => {
  it('extracts metadata from title and meta tags', () => {
    const html = `
      <html>
        <head>
          <title>Example Title</title>
          <meta name="description" content="Example description" />
          <meta name="author" content="Example Author" />
        </head>
        <body><p>Content</p></body>
      </html>
    `;

    const result = extractContent(html, 'https://example.com', {
      extractArticle: false,
    });

    expect(result.metadata.title).toBe('Example Title');
    expect(result.metadata.description).toBe('Example description');
    expect(result.metadata.author).toBe('Example Author');
    expect(result.article).toBeNull();
  });

  it('returns empty result for invalid input', () => {
    const result = extractContent('', '', { extractArticle: false });
    expect(result.article).toBeNull();
    expect(result.metadata).toEqual({});
  });
});
