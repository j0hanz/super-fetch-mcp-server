import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createContentMetadataBlock,
  determineContentExtractionSource,
  isExtractionSufficient,
} from '../dist/tools/utils/content-shaping.js';

describe('determineContentExtractionSource', () => {
  it('returns true when extraction is enabled and article exists', () => {
    const result = determineContentExtractionSource({
      content: '<p>content</p>',
      textContent: 'content',
    });
    assert.equal(result, true);
  });
});

describe('createContentMetadataBlock', () => {
  it('builds metadata when enabled', () => {
    const metadata = createContentMetadataBlock(
      'https://example.com',
      { title: 'Example', content: '', textContent: '' },
      { title: 'Fallback' },
      true,
      true
    );
    assert.equal(metadata?.url, 'https://example.com');
    assert.equal(metadata?.title, 'Example');
    assert.equal(typeof metadata?.fetchedAt, 'string');
  });

  it('returns undefined when metadata is disabled', () => {
    const metadata = createContentMetadataBlock(
      'https://example.com',
      null,
      { title: 'Fallback' },
      false,
      false
    );
    assert.equal(metadata, undefined);
  });
});

describe('isExtractionSufficient', () => {
  it('returns false for null article', () => {
    const result = isExtractionSufficient(null, '<p>some content</p>');
    assert.equal(result, false);
  });

  it('returns true for short original HTML (below threshold)', () => {
    const result = isExtractionSufficient(
      { content: '<p>x</p>', textContent: 'x' },
      '<p>short</p>' // Less than 100 chars estimated
    );
    assert.equal(result, true);
  });

  it('returns true when article retains sufficient content (>30%)', () => {
    // Original: 200 chars of text, Article: 100 chars = 50% retained
    const longText = 'a'.repeat(200);
    const articleText = 'a'.repeat(100);
    const result = isExtractionSufficient(
      { content: `<p>${articleText}</p>`, textContent: articleText },
      `<div><p>${longText}</p></div>`
    );
    assert.equal(result, true);
  });

  it('returns false when article retains too little content (<30%)', () => {
    // Original: 500 chars of text, Article: 50 chars = 10% retained
    const longText = 'a'.repeat(500);
    const articleText = 'a'.repeat(50);
    const result = isExtractionSufficient(
      { content: `<p>${articleText}</p>`, textContent: articleText },
      `<div><p>${longText}</p></div>`
    );
    assert.equal(result, false);
  });

  it('handles article with empty textContent', () => {
    const result = isExtractionSufficient(
      { content: '<p></p>', textContent: '' },
      '<div><p>test content here</p></div>'.repeat(10)
    );
    // textContent is empty (0 length) so ratio = 0, should return false
    assert.equal(result, false);
  });
});
