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

/**
 * Validate resolved IP addresses to prevent DNS rebinding attacks.
 * This should be called after DNS resolution to ensure the resolved
 * IPs are not in blocked private ranges.
 */
export async function validateResolvedIps(hostname: string): Promise<void> {
  // Skip validation for direct IP addresses (already validated in validateAndNormalizeUrl)
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return;
  }

  try {
    // Resolve IPv4 addresses
    const ipv4Addresses = await dns.resolve4(hostname).catch(() => []);
    for (const ip of ipv4Addresses) {
      if (isBlockedIp(ip) || BLOCKED_HOSTS.has(ip)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to blocked IP ${ip}`
        );
      }
    }

    // Resolve IPv6 addresses
    const ipv6Addresses = await dns.resolve6(hostname).catch(() => []);
    for (const ip of ipv6Addresses) {
      if (isBlockedIp(ip) || BLOCKED_HOSTS.has(ip)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to blocked IP ${ip}`
        );
      }
    }
  } catch (error) {
    // Re-throw Error, ignore DNS resolution errors
    if (error instanceof Error && error.message.includes('DNS rebinding')) {
      throw error;
    }
    // DNS resolution failed - let the actual request handle the error
  }
}

export function validateAndNormalizeUrl(urlString: string): string {
  // Check for empty or whitespace-only input
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL is required');
  }

  const trimmedUrl = urlString.trim();
  if (!trimmedUrl) {
    throw new Error('URL cannot be empty');
  }

  // Check URL length to prevent DoS
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

  // Only allow HTTP(S) protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid protocol: ${url.protocol}. Only http: and https: are allowed`
    );
  }

  // Block URLs with credentials (user:pass@host)
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase();

  // Block empty hostname
  if (!hostname) {
    throw new Error('URL must have a valid hostname');
  }

  // Block known internal/metadata hosts
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(
      `Blocked host: ${hostname}. Internal hosts are not allowed`
    );
  }

  // Block private IP ranges
  if (isBlockedIp(hostname)) {
    throw new Error(
      `Blocked IP range: ${hostname}. Private IPs are not allowed`
    );
  }

  // Block hostnames that look like they might resolve to internal addresses
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
