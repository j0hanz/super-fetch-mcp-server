import { isIP } from 'node:net';

function takeFirstHostValue(value: string): string | null {
  const first = value.split(',')[0];
  if (!first) return null;
  const trimmed = first.trim();
  return trimmed ? trimmed : null;
}

function stripIpv6Brackets(value: string): string | null {
  if (!value.startsWith('[')) return null;
  const end = value.indexOf(']');
  if (end === -1) return null;
  return value.slice(1, end);
}

function stripPortIfPresent(value: string): string {
  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) return value;
  return value.slice(0, colonIndex);
}

export function normalizeHost(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const first = takeFirstHostValue(trimmed);
  if (!first) return null;

  const ipv6 = stripIpv6Brackets(first);
  if (ipv6) return ipv6;

  if (isIP(first) === 6) {
    return first;
  }

  return stripPortIfPresent(first);
}
