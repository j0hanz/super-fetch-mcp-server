import { isIP } from 'node:net';

export function normalizeHost(value: string): string | null {
  const trimmedLower = value.trim().toLowerCase();
  if (!trimmedLower) return null;

  const first = takeFirstHostValue(trimmedLower);
  if (!first) return null;

  const ipv6 = stripIpv6Brackets(first);
  if (ipv6) return stripTrailingDots(ipv6);

  if (isIpV6Literal(first)) {
    return stripTrailingDots(first);
  }

  return stripTrailingDots(stripPortIfPresent(first));
}

function takeFirstHostValue(value: string): string | null {
  // Faster than split(',') for large forwarded headers; preserves behavior.
  const commaIndex = value.indexOf(',');
  const first = commaIndex === -1 ? value : value.slice(0, commaIndex);
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

function isIpV6Literal(value: string): boolean {
  return isIP(value) === 6;
}

function stripTrailingDots(value: string): string {
  // Keep loop (rather than regex) to preserve exact behavior and avoid hidden allocations.
  let result = value;
  while (result.endsWith('.')) result = result.slice(0, -1);
  return result;
}
