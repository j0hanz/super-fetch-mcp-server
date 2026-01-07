import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractContent } from '../dist/services/extractor.js';

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

    assert.equal(result.metadata.title, 'Example Title');
    assert.equal(result.metadata.description, 'Example description');
    assert.equal(result.metadata.author, 'Example Author');
    assert.equal(result.article, null);
  });

  it('prefers OpenGraph metadata over Twitter and standard metadata', () => {
    const html = `
      <html>
        <head>
          <title>Standard Title</title>
          <meta name="description" content="Standard description" />
          <meta name="twitter:title" content="Twitter Title" />
          <meta name="twitter:description" content="Twitter description" />
          <meta property="og:title" content="  OG Title  " />
          <meta property="og:description" content="OG description" />
        </head>
        <body><p>Content</p></body>
      </html>
    `;

    const result = extractContent(html, 'https://example.com', {
      extractArticle: false,
    });

    assert.equal(result.metadata.title, 'OG Title');
    assert.equal(result.metadata.description, 'OG description');
  });

  it('prefers Twitter metadata over standard metadata when OpenGraph is absent', () => {
    const html = `
      <html>
        <head>
          <title>Standard Title</title>
          <meta name="description" content="Standard description" />
          <meta name="twitter:title" content="Twitter Title" />
          <meta name="twitter:description" content="Twitter description" />
        </head>
        <body><p>Content</p></body>
      </html>
    `;

    const result = extractContent(html, 'https://example.com', {
      extractArticle: false,
    });

    assert.equal(result.metadata.title, 'Twitter Title');
    assert.equal(result.metadata.description, 'Twitter description');
  });

  it('returns empty result for invalid input', () => {
    const result = extractContent('', '', { extractArticle: false });
    assert.equal(result.article, null);
    assert.deepEqual(result.metadata, {});
  });
});
