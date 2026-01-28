/**
 * Deterministic JSON stringify for cache keys.
 * Sorts object keys to ensure {a:1, b:2} and {b:2, a:1} produce the same string.
 */
export function stableStringify(obj: unknown): string {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return JSON.stringify(obj.map(stableStringify));
  }

  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  const record = obj as Record<string, unknown>;
  const sortedObj: Record<string, unknown> = {};

  for (const key of keys) {
    sortedObj[key] = record[key];
  }

  return JSON.stringify(sortedObj);
}
