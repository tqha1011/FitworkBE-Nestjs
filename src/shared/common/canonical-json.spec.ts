import { canonicalStringify, hashCanonicalJson } from './canonical-json';

describe('canonical JSON', () => {
  it('sorts object keys recursively', () => {
    expect(
      canonicalStringify({
        title: 'Backend Engineer',
        category: { name: 'Engineering', id: 1 },
      }),
    ).toBe(
      '{"category":{"id":1,"name":"Engineering"},"title":"Backend Engineer"}',
    );
  });

  it('produces the same hash regardless of object key insertion order', () => {
    const first = {
      title: 'Backend Engineer',
      location: 'Remote',
      category: { id: 1, name: 'Engineering' },
    };
    const second = {
      category: { name: 'Engineering', id: 1 },
      location: 'Remote',
      title: 'Backend Engineer',
    };

    expect(hashCanonicalJson(first)).toBe(hashCanonicalJson(second));
  });

  it('preserves array order', () => {
    const first = { skills: [{ id: 1 }, { id: 2 }] };
    const second = { skills: [{ id: 2 }, { id: 1 }] };

    expect(canonicalStringify(first)).toBe('{"skills":[{"id":1},{"id":2}]}');
    expect(hashCanonicalJson(first)).not.toBe(hashCanonicalJson(second));
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    BigInt(1),
    new Date(),
  ])('rejects values that are not canonical JSON: %p', (value) => {
    expect(() => canonicalStringify(value)).toThrow(TypeError);
  });

  it('returns a SHA-256 hex digest', () => {
    expect(hashCanonicalJson({ schemaVersion: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});
