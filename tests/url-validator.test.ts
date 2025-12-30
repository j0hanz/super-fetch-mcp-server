import { describe, expect, it } from 'vitest';

import { validateAndNormalizeUrl } from '../src/utils/url-validator.js';

describe('validateAndNormalizeUrl', () => {
  it('returns a normalized URL for valid input', async () => {
    await expect(
      validateAndNormalizeUrl('https://example.com/path')
    ).resolves.toBe('https://example.com/path');
  });

  it('trims surrounding whitespace', async () => {
    await expect(
      validateAndNormalizeUrl('  https://example.com/path  ')
    ).resolves.toBe('https://example.com/path');
  });

  it('rejects empty input', async () => {
    await expect(validateAndNormalizeUrl('')).rejects.toThrow(
      'URL is required'
    );
  });

  it('rejects whitespace-only input', async () => {
    await expect(validateAndNormalizeUrl('   ')).rejects.toThrow(
      'URL cannot be empty'
    );
  });

  it('rejects overly long URLs', async () => {
    const longUrl = `https://example.com/${'a'.repeat(2050)}`;
    await expect(validateAndNormalizeUrl(longUrl)).rejects.toThrow(
      'URL exceeds maximum length'
    );
  });

  it('rejects invalid URL formats', async () => {
    await expect(validateAndNormalizeUrl('http://:invalid')).rejects.toThrow(
      'Invalid URL format'
    );
  });

  it('rejects unsupported protocols', async () => {
    await expect(validateAndNormalizeUrl('ftp://example.com')).rejects.toThrow(
      'Invalid protocol'
    );
  });

  it('rejects embedded credentials', async () => {
    await expect(
      validateAndNormalizeUrl('https://user:pass@example.com')
    ).rejects.toThrow('embedded credentials');
  });

  it('rejects blocked hosts', async () => {
    await expect(validateAndNormalizeUrl('http://localhost')).rejects.toThrow(
      'Blocked host'
    );
  });

  it('rejects blocked IP ranges', async () => {
    await expect(validateAndNormalizeUrl('http://10.0.0.1')).rejects.toThrow(
      'Blocked IP range'
    );
  });

  it('rejects internal hostname suffixes', async () => {
    await expect(
      validateAndNormalizeUrl('https://example.local')
    ).rejects.toThrow('Blocked hostname pattern');
  });
});
