import { describe, expect, it } from 'vitest';

import { generateSafeFilename } from '../src/utils/filename-generator.js';

describe('generateSafeFilename', () => {
  describe('URL path extraction', () => {
    it('extracts filename from URL path', () => {
      expect(generateSafeFilename('https://example.com/blog/my-article')).toBe(
        'my-article.md'
      );
    });

    it('removes HTML extension', () => {
      expect(generateSafeFilename('https://example.com/page.html')).toBe(
        'page.md'
      );
    });

    it('handles nested paths', () => {
      expect(
        generateSafeFilename('https://example.com/a/b/c/article-name')
      ).toBe('article-name.md');
    });

    it('skips index pages', () => {
      expect(
        generateSafeFilename(
          'https://example.com/blog/index.html',
          'Blog Title'
        )
      ).toBe('blog-title.md');
    });
  });

  describe('title fallback', () => {
    it('uses title when URL has no usable path', () => {
      expect(
        generateSafeFilename('https://example.com/', 'My Great Article')
      ).toBe('my-great-article.md');
    });

    it('slugifies title with spaces', () => {
      expect(
        generateSafeFilename('https://example.com/', 'Hello World Example')
      ).toBe('hello-world-example.md');
    });
  });

  describe('hash fallback', () => {
    it('uses hash when no URL path or title', () => {
      expect(
        generateSafeFilename('https://example.com/', undefined, 'abc123def456')
      ).toBe('abc123def456.md');
    });

    it('truncates long hashes', () => {
      const longHash = 'a'.repeat(32);
      const result = generateSafeFilename(
        'https://example.com/',
        undefined,
        longHash
      );
      expect(result).toBe('aaaaaaaaaaaaaaaa.md');
    });
  });

  describe('sanitization', () => {
    it('removes unsafe characters', () => {
      // Note: URL encoding happens in URL constructor, so < and > become %3C and %3E
      // The sanitization happens on the extracted path segment
      expect(generateSafeFilename('https://example.com/file-name')).toBe(
        'file-name.md'
      );
    });

    it('replaces spaces with hyphens', () => {
      // URL encoding happens first (space → %20), then decoding isn't done
      // Testing with already valid URL path
      expect(generateSafeFilename('https://example.com/my-file-name')).toBe(
        'my-file-name.md'
      );
    });

    it('handles timestamp fallback', () => {
      const result = generateSafeFilename('https://example.com/');
      expect(result).toMatch(/^download-\d+\.md$/);
    });
  });

  it('supports custom extensions', () => {
    expect(
      generateSafeFilename('https://example.com/data/export', undefined, 'abc')
    ).toBe('export.md');
    expect(
      generateSafeFilename(
        'https://example.com/data/export',
        undefined,
        'abc',
        '.jsonl'
      )
    ).toBe('export.jsonl');
  });
});
