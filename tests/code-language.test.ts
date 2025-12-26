import { describe, expect, it } from 'vitest';

import {
  detectLanguageFromCode,
  resolveLanguageFromAttributes,
} from '../src/utils/code-language.js';

describe('detectLanguageFromCode', () => {
  it('detects JavaScript snippets', () => {
    expect(detectLanguageFromCode('const x = 1;')).toBe('javascript');
  });

  it('detects Python snippets', () => {
    expect(detectLanguageFromCode('def run():\n  print(\"ok\")')).toBe(
      'python'
    );
  });

  it('returns undefined for unknown snippets', () => {
    expect(detectLanguageFromCode('this is not code')).toBeUndefined();
  });

  it('extracts language from class names', () => {
    expect(resolveLanguageFromAttributes('language-typescript', '')).toBe(
      'typescript'
    );
  });

  it('extracts language from data-language', () => {
    expect(resolveLanguageFromAttributes('', 'python')).toBe('python');
  });
});
