import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { Trim } from './trim.decorator.js';

class Host {
  @Trim()
  value!: unknown;
}

function transform(value: unknown): unknown {
  return plainToInstance(Host, { value }).value;
}

describe('@Trim', () => {
  it('removes surrounding whitespace from a string', () => {
    expect(transform('  rishab  ')).toBe('rishab');
  });

  it('keeps the case of the input unchanged', () => {
    expect(transform('  Rishab  ')).toBe('Rishab');
    expect(transform('  Rishab Jaiswal  ')).toBe('Rishab Jaiswal');
  });

  it('passes a non-string value through untouched', () => {
    expect(transform(42)).toBe(42);
    expect(transform(null)).toBeNull();
    expect(transform(undefined)).toBeUndefined();
  });

  it('is a no-op on an already-trimmed string', () => {
    expect(transform('tight')).toBe('tight');
  });
});
