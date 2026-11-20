import type { Config } from 'jest';

// Files that have no executable logic worth measuring: migrations, bootstrap
// scripts, module metadata, entities (decorator-only), and DTOs (decorator-only).
// Decorator files and the data-source config stay in because they contain
// small amounts of real logic we DO want tested.
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
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: coverageFrom,
  coverageDirectory: 'coverage/unit',
  coverageReporters: ['json', 'text', 'lcov'],
};

export default config;
