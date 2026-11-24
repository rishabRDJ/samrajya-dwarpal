import 'reflect-metadata';
import { validate } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN, IsPassword } from './password.js';

// A tiny host class to exercise @IsPassword without importing a DTO.
class Host {
  @IsPassword()
  value!: string;
}

async function errorsFor(value: unknown): Promise<string[]> {
  const h = new Host();
  (h as unknown as { value: unknown }).value = value;
  const errors = await validate(h);
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('@IsPassword', () => {
  it('exports stable constants', () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_MAX).toBe(128);
  });

  it('accepts exactly PASSWORD_MIN characters', async () => {
    expect(await errorsFor('a'.repeat(PASSWORD_MIN))).toEqual([]);
  });

  it('rejects one character below PASSWORD_MIN', async () => {
    const errs = await errorsFor('a'.repeat(PASSWORD_MIN - 1));
    expect(errs).toContain('minLength');
  });

  it('accepts exactly PASSWORD_MAX characters', async () => {
    expect(await errorsFor('a'.repeat(PASSWORD_MAX))).toEqual([]);
  });

  it('rejects one character above PASSWORD_MAX', async () => {
    const errs = await errorsFor('a'.repeat(PASSWORD_MAX + 1));
    expect(errs).toContain('maxLength');
  });

  it('rejects a non-string value', async () => {
    const errs = await errorsFor(12345678);
    expect(errs).toContain('isString');
  });
});
