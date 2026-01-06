import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateAndNormalizeUrl } from '../dist/utils/url-validator.js';

describe('validateAndNormalizeUrl', () => {
  it('returns a normalized URL for valid input', () => {
    const result = validateAndNormalizeUrl('https://example.com/path');
    assert.equal(result, 'https://example.com/path');
  });

  it('trims surrounding whitespace', () => {
    const result = validateAndNormalizeUrl('  https://example.com/path  ');
    assert.equal(result, 'https://example.com/path');
  });

  it('rejects empty input', () => {
    assert.throws(() => validateAndNormalizeUrl(''), {
      message: 'URL is required',
    });
  });

  it('rejects whitespace-only input', () => {
    assert.throws(() => validateAndNormalizeUrl('   '), {
      message: 'URL cannot be empty',
    });
  });

  it('rejects overly long URLs', () => {
    const longUrl = `https://example.com/${'a'.repeat(2050)}`;
    assert.throws(() => validateAndNormalizeUrl(longUrl), {
      message: 'URL exceeds maximum length of 2048 characters',
    });
  });

  it('rejects invalid URL formats', () => {
    assert.throws(() => validateAndNormalizeUrl('http://:invalid'), {
      message: 'Invalid URL format',
    });
  });

  it('rejects unsupported protocols', () => {
    assert.throws(() => validateAndNormalizeUrl('ftp://example.com'), {
      message: 'Invalid protocol: ftp:. Only http: and https: are allowed',
    });
  });

  it('rejects embedded credentials', () => {
    assert.throws(
      () => validateAndNormalizeUrl('https://user:pass@example.com'),
      { message: 'URLs with embedded credentials are not allowed' }
    );
  });

  it('rejects blocked hosts', () => {
    assert.throws(() => validateAndNormalizeUrl('http://localhost'), {
      message: 'Blocked host: localhost. Internal hosts are not allowed',
    });
  });

  it('rejects blocked IP ranges', () => {
    assert.throws(() => validateAndNormalizeUrl('http://10.0.0.1'), {
      message: 'Blocked IP range: 10.0.0.1. Private IPs are not allowed',
    });
  });

  it('rejects internal hostname suffixes', () => {
    assert.throws(() => validateAndNormalizeUrl('https://example.local'), {
      message:
        'Blocked hostname pattern: example.local. Internal domain suffixes are not allowed',
    });
  });
});
