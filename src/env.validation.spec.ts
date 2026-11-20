import 'reflect-metadata';
import { validateEnv } from './env.validation.js';

const base = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_ACCESS_EXPIRES_IN: '15m',
  REFRESH_TOKEN_TTL_DAYS: '7',
};

describe('validateEnv', () => {
  it('accepts a fully valid environment', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a malformed JWT_ACCESS_EXPIRES_IN', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_EXPIRES_IN: '15minutes' })).toThrow(/JWT_ACCESS_EXPIRES_IN/);
  });

  it('rejects a missing DB_HOST', () => {
    const without: Record<string, string> = { ...base };
    delete without.DB_HOST;
    expect(() => validateEnv(without)).toThrow(/DB_HOST/);
  });
});
