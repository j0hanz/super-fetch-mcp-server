import { describe, expect, it } from 'vitest';

import { validateAndNormalizeUrl } from '../src/utils/url-validator.js';

describe('validateAndNormalizeUrl', () => {
  it('returns a normalized URL for valid input', () => {
    const url = validateAndNormalizeUrl('https://example.com/path');
    expect(url).toBe('https://example.com/path');
  });

  it('trims surrounding whitespace', () => {
    const url = validateAndNormalizeUrl('  https://example.com/path  ');
    expect(url).toBe('https://example.com/path');
  });

  it('rejects empty input', () => {
    expect(() => validateAndNormalizeUrl('')).toThrow('URL is required');
  });

  it('rejects whitespace-only input', () => {
    expect(() => validateAndNormalizeUrl('   ')).toThrow('URL cannot be empty');
  });

  it('rejects overly long URLs', () => {
    const longUrl = `https://example.com/${'a'.repeat(2050)}`;
    expect(() => validateAndNormalizeUrl(longUrl)).toThrow(
      'URL exceeds maximum length'
    );
  });

  it('rejects invalid URL formats', () => {
    expect(() => validateAndNormalizeUrl('http://:invalid')).toThrow(
      'Invalid URL format'
    );
  });

  it('rejects unsupported protocols', () => {
    expect(() => validateAndNormalizeUrl('ftp://example.com')).toThrow(
      'Invalid protocol'
    );
  });

  it('rejects embedded credentials', () => {
    expect(() =>
      validateAndNormalizeUrl('https://user:pass@example.com')
    ).toThrow('embedded credentials');
  });

  it('rejects blocked hosts', () => {
    expect(() => validateAndNormalizeUrl('http://localhost')).toThrow(
      'Blocked host'
    );
  });

  it('rejects blocked IP ranges', () => {
    expect(() => validateAndNormalizeUrl('http://10.0.0.1')).toThrow(
      'Blocked IP range'
    );
  });

  it('rejects internal hostname suffixes', () => {
    expect(() => validateAndNormalizeUrl('https://example.local')).toThrow(
      'Blocked hostname pattern'
    );
  });
});
