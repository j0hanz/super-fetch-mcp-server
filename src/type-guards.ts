export function isObject(
  value: unknown
): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isError(value: unknown): value is Error {
  const ErrorConstructor = Error as unknown as {
    isError(err: unknown): err is Error;
  };
  if (typeof ErrorConstructor.isError === 'function') {
    return ErrorConstructor.isError(value);
  }
  return value instanceof Error;
}
