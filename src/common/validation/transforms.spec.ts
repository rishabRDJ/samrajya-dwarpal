import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { Trim, TrimLower, TrimUpper } from './transforms.js';

function makeHost(decorator: PropertyDecorator) {
  class Host {
    value!: unknown;
  }
  decorator(Host.prototype, 'value');
  return (v: unknown): unknown => plainToInstance(Host, { value: v }).value;
}

const trim = makeHost(Trim());
const trimLower = makeHost(TrimLower());
const trimUpper = makeHost(TrimUpper());

describe('@Trim', () => {
  it('removes surrounding whitespace', () => {
    expect(trim('  rishab  ')).toBe('rishab');
  });
  it('keeps the case unchanged', () => {
    expect(trim('  Rishab Jaiswal  ')).toBe('Rishab Jaiswal');
  });
  it('passes non-strings through', () => {
    expect(trim(42)).toBe(42);
    expect(trim(null)).toBeNull();
    expect(trim(undefined)).toBeUndefined();
  });
});

describe('@TrimLower', () => {
  it('trims AND lowercases', () => {
    expect(trimLower('  Rishab@Example.COM ')).toBe('rishab@example.com');
  });
  it('is idempotent on an already-canonical value', () => {
    expect(trimLower('rishab@example.com')).toBe('rishab@example.com');
  });
  it('passes non-strings through', () => {
    expect(trimLower(42)).toBe(42);
    expect(trimLower(null)).toBeNull();
  });
});

describe('@TrimUpper', () => {
  it('trims AND uppercases', () => {
    expect(trimUpper('  in  ')).toBe('IN');
  });
  it('passes non-strings through', () => {
    expect(trimUpper(42)).toBe(42);
    expect(trimUpper(null)).toBeNull();
  });
});
