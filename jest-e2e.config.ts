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
  collectCoverageFrom: coverageFrom,
  coverageDirectory: 'coverage/e2e',
  coverageReporters: ['json', 'text', 'lcov'],
};

export default config;
