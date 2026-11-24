import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsIndianMobile, PHONE_REGEX } from './phone.js';

class Host {
  @IsIndianMobile()
  value!: string;
}

async function errorsFor(value: unknown): Promise<string[]> {
  const inst = plainToInstance(Host, { value });
  const errors = await validate(inst);
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}));
}

async function transformedValue(value: unknown): Promise<unknown> {
  return plainToInstance(Host, { value }).value;
}

describe('PHONE_REGEX', () => {
  it('matches a leading 6/7/8/9 plus nine more digits', () => {
    expect(PHONE_REGEX.test('9876543210')).toBe(true);
    expect(PHONE_REGEX.test('6000000000')).toBe(true);
  });

  it('rejects a leading 0-5', () => {
    for (const first of ['0', '1', '2', '3', '4', '5']) {
      expect(PHONE_REGEX.test(`${first}876543210`)).toBe(false);
    }
  });
});

describe('@IsIndianMobile', () => {
  it('accepts 9876543210', async () => {
    expect(await errorsFor('9876543210')).toEqual([]);
  });

  it('rejects E.164 with country code (+91...)', async () => {
    const errs = await errorsFor('+919876543210');
    expect(errs).toContain('matches');
  });

  it('rejects a leading 5 (not a valid Indian mobile prefix)', async () => {
    const errs = await errorsFor('5876543210');
    expect(errs).toContain('matches');
  });

  it('rejects too-short numbers', async () => {
    const errs = await errorsFor('987654321');
    expect(errs).toContain('matches');
  });

  it('rejects numbers with embedded whitespace', async () => {
    const errs = await errorsFor('98765 43210');
    expect(errs).toContain('matches');
  });

  it('trims surrounding whitespace before validating (succeeds)', async () => {
    expect(await errorsFor('  9876543210  ')).toEqual([]);
    expect(await transformedValue('  9876543210  ')).toBe('9876543210');
  });
});
