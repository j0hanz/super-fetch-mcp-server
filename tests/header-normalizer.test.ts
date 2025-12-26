import { describe, expect, it } from 'vitest';

import {
  hasHeaderEntries,
  headersToRecord,
  normalizeHeaderEntries,
  normalizeHeaderRecord,
} from '../src/utils/header-normalizer.js';

describe('header-normalizer', () => {
  it('filters blocked headers and preserves values by default', () => {
    const blocked = new Set(['authorization']);
    const normalized = normalizeHeaderEntries(
      {
        Authorization: 'Bearer token',
        Accept: 'text/html',
      },
      blocked
    );

    expect(hasHeaderEntries(normalized)).toBe(true);
    expect(headersToRecord(normalized)).toEqual({ accept: 'text/html' });
  });

  it('returns undefined when no headers remain after filtering', () => {
    const blocked = new Set(['x-test']);
    const result = normalizeHeaderRecord({ 'X-Test': 'value' }, blocked);
    expect(result).toBeUndefined();
  });

  it('trims values when requested', () => {
    const blocked = new Set<string>();
    const normalized = normalizeHeaderEntries(
      {
        'X-Test': ' value ',
      },
      blocked,
      { trimValues: true }
    );

    expect(headersToRecord(normalized)).toEqual({ 'x-test': 'value' });
  });
});
