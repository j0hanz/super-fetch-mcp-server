import dns from 'dns/promises';

import { config } from '../config/index.js';

/**
 * Check if an IP address is in a blocked private range
 */
export function isBlockedIp(ip: string): boolean {
  return config.security.blockedIpPatterns.some((pattern) => pattern.test(ip));
}

export async function validateResolvedIps(hostname: string): Promise<void> {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return;
  }

  try {
    const ipv4Addresses = await dns.resolve4(hostname).catch(() => []);
    for (const ip of ipv4Addresses) {
      if (isBlockedIp(ip) || config.security.blockedHosts.has(ip)) {
        throw new Error(
          `DNS rebinding detected: ${hostname} resolves to blocked IP ${ip}`
        );
      }
    }

    const ipv6Addresses = await dns.resolve6(hostname).catch(() => []);
    for (const ip of ipv6Addresses) {
      if (isBlockedIp(ip) || config.security.blockedHosts.has(ip)) {
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

  if (config.security.blockedHosts.has(hostname)) {
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
