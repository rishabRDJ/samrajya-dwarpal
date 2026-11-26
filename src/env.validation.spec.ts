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
  APP_ENV: 'local',
  ENCRYPTION_KEY: 'a'.repeat(64),
  FYERS_APP_ID: 'ABC123-100',
  FYERS_SECRET: 'secret-at-least-8',
  FYERS_REDIRECT_URI: 'http://localhost:3000/callback',
  DARBAR_APP_URL: 'http://localhost:3001',
  SYSTEM_API_KEY: 'b'.repeat(64),
};

describe('validateEnv', () => {
  it('accepts a fully valid environment', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('accepts LOG_LEVEL when provided', () => {
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'debug' })).not.toThrow();
  });

  it('rejects an APP_ENV outside the known set', () => {
    expect(() => validateEnv({ ...base, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'debg' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects a missing APP_ENV', () => {
    const without: Record<string, string> = { ...base };
    delete without.APP_ENV;
    expect(() => validateEnv(without)).toThrow(/APP_ENV/);
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
