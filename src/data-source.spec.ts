import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import type { MysqlDataSourceOptions } from 'typeorm/driver/mysql/MysqlDataSourceOptions.js';

const ENV_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

async function loadDataSource(): Promise<DataSource> {
  // Reset the module cache so the module re-reads process.env on each import.
  jest.resetModules();
  const mod = await import('./data-source.js');
  return mod.default as DataSource;
}

describe('data-source', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.DB_HOST = 'db.example.com';
    process.env.DB_PORT = '3307';
    process.env.DB_USER = 'tester';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'darbar_test';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('builds a mysql DataSource from env vars', async () => {
    const ds = await loadDataSource();
    const options = ds.options as MysqlDataSourceOptions;
    expect(options.type).toBe('mysql');
    expect(options.host).toBe('db.example.com');
    expect(options.port).toBe(3307);
    expect(options.username).toBe('tester');
    expect(options.password).toBe('secret');
    expect(options.database).toBe('darbar_test');
  });

  it('coerces DB_PORT to a number', async () => {
    process.env.DB_PORT = '3310';
    const ds = await loadDataSource();
    const options = ds.options as MysqlDataSourceOptions;
    expect(options.port).toBe(3310);
    expect(typeof options.port).toBe('number');
  });

  it('configures SSL with rejectUnauthorized=false', async () => {
    const ds = await loadDataSource();
    const options = ds.options as MysqlDataSourceOptions;
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('points entities and migrations at the dist build output', async () => {
    const ds = await loadDataSource();
    const options = ds.options as MysqlDataSourceOptions;
    expect(options.entities).toEqual(['dist/**/*.entity.js']);
    expect(options.migrations).toEqual(['dist/migrations/*.js']);
    expect(options.migrationsTableName).toBe('typeorm_migrations');
  });

  it('is not initialized at module load', async () => {
    const ds = await loadDataSource();
    expect(ds.isInitialized).toBe(false);
  });
});
