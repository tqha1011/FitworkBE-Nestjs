import { createHash } from 'crypto';

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function canonicalize(value: unknown, path: string): CanonicalJsonValue {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`Non-finite number at ${path}`);
      }
      return value;
    case 'object': {
      if (Array.isArray(value)) {
        return value.map((item, index) =>
          canonicalize(item, `${path}[${index}]`),
        );
      }

      const prototype = Reflect.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`Non-plain object at ${path}`);
      }

      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => [key, canonicalize(item, `${path}.${key}`)]),
      );
    }
    default:
      throw new TypeError(`Unsupported JSON value at ${path}`);
  }
}

export function canonicalStringify(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value, '$'));
  if (serialized === undefined) {
    throw new TypeError('Unable to serialize canonical JSON');
  }
  return serialized;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalStringify(value), 'utf8')
    .digest('hex');
}
