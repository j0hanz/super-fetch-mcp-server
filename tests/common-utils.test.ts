import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createContentMetadataBlock,
  determineContentExtractionSource,
  isExtractionSufficient,
} from '../dist/tools/utils/content-shaping.js';

type ExtractionCase = {
  name: string;
  article: { content: string; textContent: string } | null;
  original: string;
  expected: boolean;
};

const retainedText = {
  longText: 'a'.repeat(200),
  articleText: 'a'.repeat(100),
};

const lowRetentionText = {
  longText: 'a'.repeat(500),
  articleText: 'a'.repeat(50),
};

const extractionCases: ExtractionCase[] = [
  {
    name: 'returns false for null article',
    article: null,
    original: '<p>some content</p>',
    expected: false,
  },
  {
    name: 'returns true for short original HTML (below threshold)',
    article: { content: '<p>x</p>', textContent: 'x' },
    original: '<p>short</p>',
    expected: true,
  },
  {
    name: 'returns true when article retains sufficient content (>30%)',
    article: {
      content: `<p>${retainedText.articleText}</p>`,
      textContent: retainedText.articleText,
    },
    original: `<div><p>${retainedText.longText}</p></div>`,
    expected: true,
  },
  {
    name: 'returns false when article retains too little content (<30%)',
    article: {
      content: `<p>${lowRetentionText.articleText}</p>`,
      textContent: lowRetentionText.articleText,
    },
    original: `<div><p>${lowRetentionText.longText}</p></div>`,
    expected: false,
  },
  {
    name: 'handles article with empty textContent',
    article: { content: '<p></p>', textContent: '' },
    original: '<div><p>test content here</p></div>'.repeat(10),
    expected: false,
  },
];

function testExtractionSourceEnabledWithArticle() {
  const result = determineContentExtractionSource({
    content: '<p>content</p>',
    textContent: 'content',
  });
  assert.equal(result, true);
}

function registerDetermineContentExtractionSourceTests() {
  describe('determineContentExtractionSource', () => {
    it('returns true when extraction is enabled and article exists', () => {
      testExtractionSourceEnabledWithArticle();
    });
  });
}

function testBuildsMetadataWhenEnabled() {
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
}

function testReturnsUndefinedWhenMetadataDisabled() {
  const metadata = createContentMetadataBlock(
    'https://example.com',
    null,
    { title: 'Fallback' },
    false,
    false
  );
  assert.equal(metadata, undefined);
}

function registerCreateContentMetadataBlockTests() {
  describe('createContentMetadataBlock', () => {
    it('builds metadata when enabled', () => {
      testBuildsMetadataWhenEnabled();
    });
    it('returns undefined when metadata is disabled', () => {
      testReturnsUndefinedWhenMetadataDisabled();
    });
  });
}

function runExtractionCase(testCase: ExtractionCase) {
  const result = isExtractionSufficient(testCase.article, testCase.original);
  assert.equal(result, testCase.expected);
}

function registerExtractionCases() {
  extractionCases.forEach((testCase) => {
    it(testCase.name, () => {
      runExtractionCase(testCase);
    });
  });
}

function registerIsExtractionSufficientTests() {
  describe('isExtractionSufficient', () => {
    registerExtractionCases();
  });
}

registerDetermineContentExtractionSourceTests();
registerCreateContentMetadataBlockTests();
registerIsExtractionSufficientTests();
