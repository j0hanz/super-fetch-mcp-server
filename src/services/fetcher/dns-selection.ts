import type { LookupAddress } from 'node:dns';

import { createErrorWithCode } from '../../utils/error-utils.js';
import { isBlockedIp } from '../../utils/url-validator.js';

function normalizeLookupResults(
  addresses: string | LookupAddress[],
  family: number | undefined
): LookupAddress[] {
  if (Array.isArray(addresses)) {
    return addresses;
  }

  return [{ address: addresses, family: family ?? 4 }];
}

function findBlockedIpError(
  list: LookupAddress[],
  hostname: string
): NodeJS.ErrnoException | null {
  for (const addr of list) {
    const ip = typeof addr === 'string' ? addr : addr.address;
    if (!isBlockedIp(ip)) {
      continue;
    }

    return createErrorWithCode(
      `Blocked IP detected for ${hostname}`,
      'EBLOCKED'
    );
  }

  return null;
}

function findInvalidFamilyError(
  list: LookupAddress[],
  hostname: string
): NodeJS.ErrnoException | null {
  for (const addr of list) {
    const family = typeof addr === 'string' ? 0 : addr.family;
    if (family === 4 || family === 6) continue;
    return createErrorWithCode(
      `Invalid address family returned for ${hostname}`,
      'EINVAL'
    );
  }

  return null;
}

function createNoDnsResultsError(hostname: string): NodeJS.ErrnoException {
  return createErrorWithCode(
    `No DNS results returned for ${hostname}`,
    'ENODATA'
  );
}

function createEmptySelection(hostname: string): {
  address: string | LookupAddress[];
  family?: number;
  error?: NodeJS.ErrnoException;
  fallback: LookupAddress[];
} {
  return {
    error: createNoDnsResultsError(hostname),
    fallback: [],
    address: [],
  };
}

function selectLookupResult(
  list: LookupAddress[],
  useAll: boolean,
  hostname: string
): {
  address: string | LookupAddress[];
  family?: number;
  error?: NodeJS.ErrnoException;
  fallback: LookupAddress[];
} {
  if (list.length === 0) return createEmptySelection(hostname);

  if (useAll) return { address: list, fallback: list };

  const first = list.at(0);
  if (!first) return createEmptySelection(hostname);

  return {
    address: first.address,
    family: first.family,
    fallback: list,
  };
}

function findLookupError(
  list: LookupAddress[],
  hostname: string
): NodeJS.ErrnoException | null {
  return (
    findInvalidFamilyError(list, hostname) ?? findBlockedIpError(list, hostname)
  );
}

export function handleLookupResult(
  error: NodeJS.ErrnoException | null,
  addresses: string | LookupAddress[],
  hostname: string,
  resolvedFamily: number | undefined,
  useAll: boolean,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
): void {
  if (error) {
    callback(error, addresses);
    return;
  }

  const list = normalizeLookupResults(addresses, resolvedFamily);
  const lookupError = findLookupError(list, hostname);
  if (lookupError) {
    callback(lookupError, list);
    return;
  }

  const selection = selectLookupResult(list, useAll, hostname);
  if (selection.error) {
    callback(selection.error, selection.fallback);
    return;
  }

  callback(null, selection.address, selection.family);
}
