import ipaddr from 'ipaddr.js';

import { config } from '../config/index.js';

/**
 * Check if an IP address is in a blocked private range
 */
function isBlockedIpv4Range(range: string): boolean {
  return (
    range === 'private' ||
    range === 'loopback' ||
    range === 'linkLocal' ||
    range === 'multicast' ||
    range === 'broadcast' ||
    range === 'reserved' ||
    range === 'unspecified'
  );
}

function isBlockedIpv6Range(range: string): boolean {
  return (
    range === 'uniqueLocal' ||
    range === 'linkLocal' ||
    range === 'loopback' ||
    range === 'multicast' ||
    range === 'reserved' ||
    range === 'unspecified' ||
    range === 'ipv4Mapped' ||
    range === 'rfc6145' ||
    range === 'rfc6052' ||
    range === '6to4' ||
    range === 'teredo'
  );
}

type IpAddress = ipaddr.IPv4 | ipaddr.IPv6;

function isIpv6Address(addr: IpAddress): addr is ipaddr.IPv6 {
  return addr.kind() === 'ipv6';
}

export function isBlockedIp(ip: string): boolean {
  if (config.security.blockedHosts.has(ip)) {
    return true;
  }

  if (!ipaddr.isValid(ip)) {
    return false;
  }

  const addr = ipaddr.parse(ip) as IpAddress;
  if (isIpv6Address(addr)) {
    if (addr.isIPv4MappedAddress()) {
      const ipv4 = addr.toIPv4Address();
      return isBlockedIpv4Range(ipv4.range());
    }

    return isBlockedIpv6Range(addr.range());
  }

  return isBlockedIpv4Range(addr.range());
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
