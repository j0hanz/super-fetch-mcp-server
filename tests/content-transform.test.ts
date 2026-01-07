import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { transformHtmlToMarkdown } from '../dist/tools/utils/content-transform.js';

type TransformResult = ReturnType<typeof transformHtmlToMarkdown>;

type RawContentCase = {
  name: string;
  input: string;
  url: string;
  includeMetadata: boolean;
  assert: (result: TransformResult) => void;
};

const rawContentCases: RawContentCase[] = [
  {
    name: 'preserves markdown with frontmatter and adds source when missing',
    input: `---\ntitle: "Hello"\n---\n\n# Heading`,
    url: 'https://example.com/file.md',
    includeMetadata: true,
    assert: (result) => {
      assert.ok(result.markdown.includes('# Heading'));
      assert.ok(
        result.markdown.includes('source: "https://example.com/file.md"')
      );
    },
  },
  {
    name: 'treats doctype/html documents as HTML (not raw)',
    input: '<!DOCTYPE html><html><body><p>Hello</p></body></html>',
    url: 'https://example.com',
    includeMetadata: false,
    assert: (result) => {
      assert.ok(result.markdown.includes('Hello'));
      assert.ok(!result.markdown.includes('<!DOCTYPE'));
    },
  },
  {
    name: 'treats <=2 common HTML tags + markdown patterns as raw',
    input: '<div>one</div><span>two</span>\n# Heading',
    url: 'https://example.com/raw',
    includeMetadata: true,
    assert: (result) => {
      assert.ok(result.markdown.includes('<div>one</div>'));
      assert.ok(result.markdown.includes('# Heading'));
      assert.ok(result.markdown.includes('source: "https://example.com/raw"'));
    },
  },
  {
    name: 'treats >2 common HTML tags as HTML even if markdown patterns exist',
    input:
      '<div>one</div><span>two</span><meta name="x" content="y">\n# Heading',
    url: 'https://example.com/html',
    includeMetadata: false,
    assert: (result) => {
      assert.ok(!result.markdown.includes('<div>'));
    },
  },
];

function runRawContentCase(testCase: RawContentCase) {
  const result = transformHtmlToMarkdown(testCase.input, testCase.url, {
    includeMetadata: testCase.includeMetadata,
  });

  testCase.assert(result);
}

function registerRawContentCases() {
  rawContentCases.forEach((testCase) => {
    it(testCase.name, () => {
      runRawContentCase(testCase);
    });
  });
}

function registerRawContentDetectionTests() {
  describe('transformHtmlToMarkdown raw content detection', () => {
    registerRawContentCases();
  });
}

registerRawContentDetectionTests();
