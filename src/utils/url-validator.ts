import dns from 'dns/promises';

import { config } from '../config/index.js';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.com',
  '100.100.100.200',
  'instance-data',
]);

const BLOCKED_IP_PATTERNS: readonly RegExp[] = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^::ffff:192\.168\./,
];

/**
 * Check if an IP address is in a blocked private range
 */
function isBlockedIp(ip: string): boolean {
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

export async function validateResolvedIps(hostname: string): Promise<void> {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return;
  }

  try {
    const ipv4Addresses = await dns.resolve4(hostname).catch(() => []);
    for (const ip of ipv4Addresses) {
      if (isBlockedIp(ip) || BLOCKED_HOSTS.has(ip)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to blocked IP ${ip}`
        );
      }
    }

    const ipv6Addresses = await dns.resolve6(hostname).catch(() => []);
    for (const ip of ipv6Addresses) {
      if (isBlockedIp(ip) || BLOCKED_HOSTS.has(ip)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to blocked IP ${ip}`
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('DNS rebinding')) {
      throw error;
    }
  }
}

export function validateAndNormalizeUrl(urlString: string): string {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL is required');
  }

  const trimmedUrl = urlString.trim();
  if (!trimmedUrl) {
    throw new Error('URL cannot be empty');
  }

  if (trimmedUrl.length > config.constants.maxUrlLength) {
    throw new Error(
      `URL exceeds maximum length of ${config.constants.maxUrlLength} characters`
    );
  }

  let url: URL;

  try {
    url = new URL(trimmedUrl);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid protocol: ${url.protocol}. Only http: and https: are allowed`
    );
  }

  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase();

  if (!hostname) {
    throw new Error('URL must have a valid hostname');
  }

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(
      `Blocked host: ${hostname}. Internal hosts are not allowed`
    );
  }

  if (isBlockedIp(hostname)) {
    throw new Error(
      `Blocked IP range: ${hostname}. Private IPs are not allowed`
    );
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(
      `Blocked hostname pattern: ${hostname}. Internal domain suffixes are not allowed`
    );
  }

  return url.href;
}

export function isInternalUrl(url: string, baseUrl: string): boolean {
  try {
    const urlObj = new URL(url, baseUrl);
    const baseUrlObj = new URL(baseUrl);
    return urlObj.hostname === baseUrlObj.hostname;
  } catch {
    return false;
  }
}
