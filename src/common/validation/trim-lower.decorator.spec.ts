import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { TrimLower } from './trim-lower.decorator.js';

class Host {
  @TrimLower()
  value!: unknown;
}

function transform(value: unknown): unknown {
  return plainToInstance(Host, { value }).value;
}

describe('@TrimLower', () => {
  it('trims surrounding whitespace AND lowercases the string', () => {
    expect(transform('  Rishab@Example.COM ')).toBe('rishab@example.com');
  });

  it('is idempotent on an already-canonical value', () => {
    expect(transform('rishab@example.com')).toBe('rishab@example.com');
  });

  it('passes a non-string value through untouched', () => {
    expect(transform(42)).toBe(42);
    expect(transform(null)).toBeNull();
    expect(transform(undefined)).toBeUndefined();
  });
});
