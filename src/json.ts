const MAX_DEPTH = 20;

function processValue(
  obj: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  // Depth guard
  if (depth > MAX_DEPTH) {
    throw new Error(`stableStringify: Max depth (${MAX_DEPTH}) exceeded`);
  }

  // Cycle detection (track active recursion stack only).
  if (seen.has(obj)) {
    throw new Error('stableStringify: Circular reference detected');
  }
  seen.add(obj);

  try {
    if (Array.isArray(obj)) {
      return obj.map((item) => processValue(item, depth + 1, seen));
    }

    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const record = obj as Record<string, unknown>;
    const sortedObj: Record<string, unknown> = {};

    for (const key of keys) {
      sortedObj[key] = processValue(record[key], depth + 1, seen);
    }

    return sortedObj;
  } finally {
    seen.delete(obj);
  }
}

export function stableStringify(
  obj: unknown,
  depth = 0,
  seen = new WeakSet()
): string {
  const processed = processValue(obj, depth, seen);
  return JSON.stringify(processed);
}
