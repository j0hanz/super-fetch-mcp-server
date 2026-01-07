import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { transformHtmlToMarkdown } from '../dist/tools/utils/content-transform.js';

describe('transformHtmlToMarkdown raw content detection', () => {
  it('preserves markdown with frontmatter and adds source when missing', () => {
    const input = `---\ntitle: "Hello"\n---\n\n# Heading`;
    const result = transformHtmlToMarkdown(
      input,
      'https://example.com/file.md',
      {
        includeMetadata: true,
      }
    );

    assert.ok(result.markdown.includes('# Heading'));
    assert.ok(
      result.markdown.includes('source: "https://example.com/file.md"')
    );
  });

  it('treats doctype/html documents as HTML (not raw)', () => {
    const html = '<!DOCTYPE html><html><body><p>Hello</p></body></html>';
    const result = transformHtmlToMarkdown(html, 'https://example.com', {
      includeMetadata: false,
    });

    assert.ok(result.markdown.includes('Hello'));
    assert.ok(!result.markdown.includes('<!DOCTYPE'));
  });

  it('treats <=2 common HTML tags + markdown patterns as raw', () => {
    const input = '<div>one</div><span>two</span>\n# Heading';
    const result = transformHtmlToMarkdown(input, 'https://example.com/raw', {
      includeMetadata: true,
    });

    assert.ok(result.markdown.includes('<div>one</div>'));
    assert.ok(result.markdown.includes('# Heading'));
    assert.ok(result.markdown.includes('source: "https://example.com/raw"'));
  });

  it('treats >2 common HTML tags as HTML even if markdown patterns exist', () => {
    const input =
      '<div>one</div><span>two</span><meta name="x" content="y">\n# Heading';
    const result = transformHtmlToMarkdown(input, 'https://example.com/html', {
      includeMetadata: false,
    });

    assert.ok(!result.markdown.includes('<div>'));
  });
});
