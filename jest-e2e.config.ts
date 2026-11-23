import type { Config } from 'jest';

const coverageFrom: string[] = [
  'src/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/main.ts',
  '!src/migrations/**',
  '!src/scripts/**',
  '!src/**/*.module.ts',
  '!src/**/*.entity.ts',
  '!src/**/*.dto.ts',
];

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  // Runs before each e2e test file; registers the @nestjs/throttler mock so
  // controller imports don't trip Node's ESM require-cycle check.
  setupFiles: ['<rootDir>/test/jest-e2e.setup.ts'],
  // Serial e2e: every suite talks to the same MySQL database. Parallel
  // suites would see each other's fixture rows — specifically, the admin
  // concurrency + stress tests count active admins globally and would
  // be inflated by admin-users's fixtures running next door, breaking
  // the last-admin invariant they rely on.
  maxWorkers: 1,
  collectCoverageFrom: coverageFrom,
  coverageDirectory: 'coverage/e2e',
  coverageReporters: ['json', 'text', 'lcov'],
};

export default config;
